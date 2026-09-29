import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elourwa_parent/src/api.dart';

/// COMME WHATSAPP : UNE SESSION GARDÉE EST UNE SESSION.
///
/// Le serveur de démonstration dort après quinze minutes ; un parent qui
/// rouvre l'application pendant qu'il se réveille recevait un 503 au
/// rafraîchissement, `restore()` rendait la main sans session, et l'écran de
/// connexion s'affichait — « il faut se reconnecter à chaque fois ». Le jeton
/// n'avait pourtant jamais été révoqué.
void main() {
  http.Response jsonRes(Map<String, dynamic> body, [int code = 200]) =>
      http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});

  test('un serveur qui dort à l’ouverture ne renvoie pas à l’écran de connexion', () async {
    FlutterSecureStorage.setMockInitialValues({});
    var serveurReveille = false;
    var refreshes = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        return jsonRes({'accessToken': 'a1', 'refreshToken': 'r1', 'user': {'mustChangePassword': false}, 'ecoles': []}, 201);
      }
      if (request.url.path == '/auth/refresh') {
        refreshes++;
        if (!serveurReveille) return http.Response('Le serveur démarre', 503);
        return jsonRes({'accessToken': 'a2', 'refreshToken': 'r2', 'ecoles': []}, 201);
      }
      if (request.url.path == '/auth/me') return jsonRes({'mustChangePassword': false, 'ecoles': []});
      return jsonRes({'message': 'unauthorised'}, 401);
    });

    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.login('30000000', 'secret');

    // Nouvelle ouverture, serveur endormi.
    final rouverte = ApiClient(baseUrl: 'https://api.test', client: client);
    await rouverte.restore();
    expect(rouverte.hasSession, isFalse, reason: 'pas de jeton d’accès tant que le serveur dort');
    expect(rouverte.credentialGardee, isTrue, reason: 'mais la session existe : on entre dans l’application');

    // Le serveur se réveille : la reprise obtient la session sans rien demander.
    serveurReveille = true;
    expect(await rouverte.reessayer(), isTrue);
    expect(rouverte.hasSession, isTrue);
    expect(refreshes, 2);
  });

  test('un refus du serveur (4xx) efface bien la session gardée', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        return jsonRes({'accessToken': 'a1', 'refreshToken': 'r1', 'user': {'mustChangePassword': false}, 'ecoles': []}, 201);
      }
      if (request.url.path == '/auth/refresh') return jsonRes({'message': 'Session révoquée.'}, 401);
      return jsonRes({}, 401);
    });
    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.login('30000000', 'secret');
    final rouverte = ApiClient(baseUrl: 'https://api.test', client: client);
    await rouverte.restore();
    expect(rouverte.hasSession, isFalse);
    expect(rouverte.credentialGardee, isFalse, reason: 'révoquée : l’écran de connexion, cette fois à raison');
  });
}
