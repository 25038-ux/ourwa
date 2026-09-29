import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/auth/auth_store.dart';

/// RESTER CONNECTÉ — what "like WhatsApp" actually requires.
///
/// A parent signs in once on their phone and stays signed in until they sign
/// out or the stored credential expires. The refresh token lives ninety days in
/// the Keychain / Keystore and is rotated on every use, which is what makes a
/// stolen copy worthless — and also what makes two of these paths dangerous.
///
/// ⚠ TWO WAYS A PARENT WAS SIGNED OUT FOR GOOD, both found by reading the retry
/// path rather than by using it:
///
///   1. `refresh()` called `logout()` on ANY non-200. A 500 or a 502 from the
///      API — a restart, a bad deploy, a proxy hiccup — DELETED the ninety-day
///      credential. The parent then had to find the password the school read out
///      at the counter months earlier.
///
///   2. A screen that fires several requests at once fires several 401s at once,
///      and each called `refresh()` with the SAME stored token. The first
///      rotated it; the second presented a spent one, which is precisely the
///      reuse the server is built to punish — it revokes the whole family. Two
///      panels loading in parallel signed the parent out of every device.
///
/// Written before the fix.
void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  Future<ApiClient> signedIn(http.Client client) async {
    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.login('41966605', 'secret');
    return api;
  }

  http.Response jsonRes(Map<String, dynamic> body, [int code = 200]) =>
      http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});

  test('a server error does NOT destroy the stored credential', () async {
    var refreshCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        return jsonRes({
          'accessToken': 'a1',
          'refreshToken': 'r1',
          'user': {'mustChangePassword': false},
        });
      }
      if (request.url.path == '/auth/refresh') {
        refreshCalls++;
        // The API is having a bad minute. This is not the parent's fault and
        // must not cost them their session.
        return jsonRes({'message': 'boom'}, 503);
      }
      return jsonRes({'message': 'unauthorised'}, 401);
    });

    final api = await signedIn(client);
    final store = AuthStore();
    expect(await store.readRefreshToken(), 'r1');

    await expectLater(api.get('/parent/children'), throwsA(isA<ApiException>()));

    expect(refreshCalls, 1);
    // ⚠ THE CREDENTIAL SURVIVES. The next launch retries and the parent never
    // sees the login screen.
    expect(await store.readRefreshToken(), 'r1');
  });

  test('a rejected token IS cleared — that session can never work again',
      () async {
    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        return jsonRes({
          'accessToken': 'a1',
          'refreshToken': 'r1',
          'user': {'mustChangePassword': false},
        });
      }
      if (request.url.path == '/auth/refresh') {
        // Spent, revoked, or the family was invalidated by a reuse elsewhere.
        return jsonRes({'message': 'Invalid refresh token'}, 401);
      }
      return jsonRes({'message': 'unauthorised'}, 401);
    });

    final api = await signedIn(client);
    await expectLater(api.get('/parent/children'), throwsA(isA<ApiException>()));

    // Keeping it would loop the parent through a credential that cannot work.
    expect(await AuthStore().readRefreshToken(), isNull);
  });

  test('⚠ concurrent 401s refresh ONCE, never twice with the same token',
      () async {
    var refreshCalls = 0;
    final presented = <String>[];
    // The only token the server will accept. Login hands out a stale one, so the
    // first request from each panel comes back 401 — which is the situation.
    const valid = 'fresh';

    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        return jsonRes({
          'accessToken': 'expired',
          'refreshToken': 'r1',
          'user': {'mustChangePassword': false},
        });
      }
      if (request.url.path == '/auth/refresh') {
        refreshCalls++;
        presented.add(
          (jsonDecode(request.body) as Map<String, dynamic>)['refreshToken'] as String,
        );
        // A real server would revoke the family on the second presentation of
        // r1. Here we only need to record that it was presented twice.
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return jsonRes({'accessToken': 'fresh', 'refreshToken': 'r2'});
      }
      final auth = request.headers['Authorization'];
      if (auth != 'Bearer $valid') return jsonRes({'message': 'unauthorised'}, 401);
      return jsonRes({'ok': true});
    });

    final api = await signedIn(client);

    // A screen that loads three panels at once. All three 401.
    final results = await Future.wait([
      api.get('/parent/children'),
      api.get('/parent/messages/unread'),
      api.get('/parent/payments'),
    ]);

    expect(results.every((r) => r['ok'] == true), isTrue);
    expect(refreshCalls, 1, reason: 'one rotation, not three');
    expect(presented, ['r1']);
    expect(await AuthStore().readRefreshToken(), 'r2');
  });

  test('restore() keeps the session across a launch', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/auth/refresh') {
        return jsonRes({'accessToken': 'a2', 'refreshToken': 'r2'});
      }
      if (request.url.path == '/auth/me') {
        return jsonRes({'mustChangePassword': false});
      }
      return jsonRes({'ok': true});
    });

    // What the previous run left in the Keychain — a profile from before the
    // one-app-for-all-branches change still carries a slug: ignored.
    await AuthStore().saveSession(refreshToken: 'r1', profile: {'slug': 'nour'});

    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.restore();

    expect(api.hasSession, isTrue);
    expect(await AuthStore().readRefreshToken(), 'r2');
  });

  test('restore() with nothing stored simply has no session', () async {
    final client = MockClient((_) async => jsonRes({'message': 'no'}, 401));
    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.restore();
    expect(api.hasSession, isFalse);
  });
}
