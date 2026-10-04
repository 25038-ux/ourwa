import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elourwa_parent/src/push.dart';

/// ⚠ UN iPHONE NE REÇOIT JAMAIS L'ID FIREBASE ANDROID (04/10/2026) : Firebase
/// iOS refuse un ID « 1:…:android:… » au démarrage, et l'application peut se
/// fermer. Sans ID iOS, l'iPhone interroge le serveur.
void main() {
  const android = '1:721820198526:android:76a37c1a083d25811d9a2f';

  test('Android : l’ID Android', () {
    expect(Push.idPour(web: false, plateforme: TargetPlatform.android, android: android, ios: ''), android);
  });

  test('⚠ iPhone sans ID iOS : rien — jamais l’ID Android', () {
    expect(Push.idPour(web: false, plateforme: TargetPlatform.iOS, android: android, ios: ''), '');
  });

  test('iPhone avec son ID iOS : le sien', () {
    const ios = '1:721820198526:ios:0123456789abcdef';
    expect(Push.idPour(web: false, plateforme: TargetPlatform.iOS, android: android, ios: ios), ios);
  });

  test('sans --dart-define (les tests) : Firebase n’est pas configuré', () {
    expect(Push.configure, isFalse);
  });
}
