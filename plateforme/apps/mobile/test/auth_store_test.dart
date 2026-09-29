import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:elourwa_parent/src/auth/auth_store.dart';

void main() {
  setUp(() {
    // The plugin has no implementation in a unit test; an in-memory map stands
    // in so the storage contract can still be asserted.
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('stores the refresh token and profile, and clears both', () async {
    final store = AuthStore();
    await store.saveSession(
      refreshToken: 'r-123',
      profile: {'user': {'fullName': 'Test Parent'}},
    );

    expect(await store.readRefreshToken(), 'r-123');
    expect((await store.readProfile())!['user']['fullName'], 'Test Parent');

    await store.clear();
    expect(await store.readRefreshToken(), isNull);
    expect(await store.readProfile(), isNull);
  });

  test('returns null when nothing has been stored', () async {
    expect(await AuthStore().readRefreshToken(), isNull);
    expect(await AuthStore().readProfile(), isNull);
  });
}
