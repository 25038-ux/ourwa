import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/telephone.dart';

/// LE NUMÉRO MAURITANIEN, LA MÊME RÈGLE DES DEUX CÔTÉS.
///
/// Les cas sont ceux de `packages/shared/src/telephone.spec.ts`, à
/// l'identique : si l'un des deux fichiers change sans l'autre, l'application
/// laisserait passer (ou refuserait) un numéro que l'API juge autrement, et le
/// parent verrait un refus qu'aucun des deux messages n'explique.
void main() {
  test('accepte les huit chiffres, avec ou sans indicatif, espaces, tirets, parenthèses', () {
    for (final s in [
      '22123456',
      '22 12 34 56',
      '+222 22-12-34-56',
      '0022222123456',
      '(22) 12 34 56',
      '+22222123456',
    ]) {
      expect(telephoneMauritanien(s), '22123456', reason: s);
    }
    expect(telephoneMauritanien('36000000'), '36000000');
    expect(telephoneMauritanien('45123456'), '45123456');
  });

  test('refuse ce qui n’est pas un numéro mauritanien', () {
    for (final s in [
      '12345678',
      '2212345',
      '221234567',
      'SANSTEL-0042',
      'admin@nour.test',
      '',
      '+33612345678',
      '+2224000000',
    ]) {
      expect(telephoneMauritanien(s), isNull, reason: s);
    }
    expect(telephoneMauritanien(null), isNull);
  });

  /// UNE APPLICATION POUR TOUTES LES BRANCHES : la connexion ne nomme aucune
  /// école. Le corps porte `espace: parent` et rien d'autre que l'identifiant
  /// et le mot de passe ; aucun en-tête `X-School-Slug` ne part, ni à la
  /// connexion ni ensuite — c'est la session de famille du serveur qui choisit
  /// les écoles, et la réponse les liste.
  test('la connexion ne porte aucune école et retient celles de la réponse', () async {
    FlutterSecureStorage.setMockInitialValues({});
    http.Request? connexion;
    http.Request? suivante;
    final client = MockClient((request) async {
      if (request.url.path == '/auth/login') {
        connexion = request;
        return http.Response(
          jsonEncode({
            'accessToken': 'a1',
            'refreshToken': 'r1',
            'user': {'mustChangePassword': false, 'locale': 'fr'},
            'ecoles': [
              {'id': '1', 'slug': 'nour', 'name': 'École Nour', 'nameAr': 'مدرسة النور'},
              {'id': '2', 'slug': 'rissala', 'name': 'École Rissala', 'nameAr': null},
            ],
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      }
      suivante = request;
      return http.Response('{"children":[]}', 200, headers: {'content-type': 'application/json'});
    });
    final api = ApiClient(baseUrl: 'https://api.test', client: client);
    await api.login('41966605', 'secret');

    final corps = jsonDecode(connexion!.body) as Map<String, dynamic>;
    expect(corps, {'identifier': '41966605', 'password': 'secret', 'espace': 'parent'});
    expect(connexion!.headers.keys.map((k) => k.toLowerCase()), isNot(contains('x-school-slug')));

    expect(api.ecoles.map((e) => e.slug), ['nour', 'rissala']);
    expect(api.ecoles[0].libelle(true), 'مدرسة النور');
    expect(api.ecoles[1].libelle(true), 'École Rissala', reason: 'sans nom arabe, le nom français');

    await api.get('/parent/children');
    expect(suivante!.headers.keys.map((k) => k.toLowerCase()), isNot(contains('x-school-slug')));
    expect(suivante!.headers['Authorization'] ?? suivante!.headers['authorization'], 'Bearer a1');
  });
}
