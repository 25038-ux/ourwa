import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the refresh token lives on a device.
///
/// iOS Keychain / Android Keystore, never SharedPreferences: a refresh token is
/// a 90-day credential, and SharedPreferences is world-readable on a rooted
/// device. The access token is deliberately NOT persisted — it lasts 15 minutes
/// and is cheap to re-obtain, so storing it only widens the window an attacker
/// has to work with.
class AuthStore {
  AuthStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;
  static const _refreshKey = 'elourwa.refresh';
  static const _profileKey = 'elourwa.profile';

  Future<void> saveSession({
    required String refreshToken,
    required Map<String, dynamic> profile,
  }) async {
    await _storage.write(key: _refreshKey, value: refreshToken);
    await _storage.write(key: _profileKey, value: jsonEncode(profile));
  }

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<Map<String, dynamic>?> readProfile() async {
    final raw = await _storage.read(key: _profileKey);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clear() async {
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _profileKey);
  }
}
