import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/child_screen.dart';
import 'package:elourwa_parent/src/notifications_screen.dart';
import 'package:elourwa_parent/src/parent_shell.dart';
import 'package:elourwa_parent/src/theme.dart';

/// « SI BON SUR TOUS LES TÉLÉPHONES » (décision du propriétaire, 19/09) :
/// la coquille, le tableau de bord et le fil des notifications se rendent sur
/// un petit téléphone (360 × 640), un téléphone courant (393 × 852) et une
/// tablette (800 × 1280) — avec des noms longs et trois écoles — sans qu'un
/// seul widget déborde. Un débordement est une erreur de rendu ; ce test la
/// transforme en échec nommé.
void main() {
  http.Response jsonRes(Object body, [int code = 200]) =>
      http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});

  final enfants = [
    for (final (i, ecole) in ['nour', 'rissala', 'salam'].indexed)
      {
        'id': 'e$i',
        'first_name': 'Mohamed Abdellahi',
        'last_name': 'Ould Cheikh Sidi Mohamed',
        'group_name': '6ème Année Fondamentale B',
        'level_name': 'Sixième',
        'is_free': false,
        'absences': 12,
        'average': '14.75',
        'examsWithheld': i == 2,
        'school': {'id': 's$i', 'slug': ecole, 'name': 'École ${ecole[0].toUpperCase()}${ecole.substring(1)} de Nouakchott', 'nameAr': null},
      },
  ];
  final notifications = [
    for (var i = 0; i < 6; i++)
      {
        'id': 'n$i',
        'kind': ['grade', 'homework', 'absence', 'remark', 'timetable', 'message'][i],
        'i18nKey': ['notif_note', 'notif_exercice', 'notif_absence', 'notif_remarque', 'notif_emploi', 'notif_message'][i],
        'i18nParams': {'eleve': 'Mohamed Abdellahi', 'matiere': 'Mathématiques appliquées', 'note': '15,5', 'trimestre': 'T1', 'titre': 'Exercices 1 à 12, page 45 — à rendre lundi', 'limite': '', 'date': '18/09/2026', 'sujet': 'Réunion des parents', 'contenu': 'La réunion aura lieu samedi à 10h dans la grande salle.'},
        'readAt': i.isEven ? null : '2026-09-18T10:00:00Z',
        'createdAt': '2026-09-${(18 - i).toString().padLeft(2, '0')}T08:30:00Z',
      },
  ];

  Future<ApiClient> api() async {
    FlutterSecureStorage.setMockInitialValues({});
    final client = MockClient((req) async {
      switch (req.url.path) {
        case '/auth/login':
          return jsonRes({'accessToken': 'a', 'refreshToken': 'r', 'user': {'mustChangePassword': false, 'locale': 'fr'}, 'ecoles': [
            {'id': 's0', 'slug': 'nour', 'name': 'École Nour de Nouakchott', 'nameAr': null},
            {'id': 's1', 'slug': 'rissala', 'name': 'École Rissala', 'nameAr': null},
            {'id': 's2', 'slug': 'salam', 'name': 'École Salam', 'nameAr': null},
          ]}, 201);
        case '/parent/children':
          return jsonRes({'academicYear': '2025-2026', 'guardianName': 'Fatimetou Mint Ahmed Salem', 'ecoles': ['a', 'b', 'c'], 'children': enfants});
        case '/parent/balance':
          return jsonRes({'total': '12500.00', 'currency': 'MRU', 'tuition': [], 'annualFees': [], 'parEcole': []});
        case '/parent/messages':
          return jsonRes({'unread': 3, 'messages': []});
        case '/parent/messages/unread':
          return jsonRes({'count': 3});
        case '/parent/notifications':
          return jsonRes({'items': notifications, 'unread': 3});
        case '/parent/notifications/unread':
          return jsonRes({'count': 3});
        default:
          return jsonRes({'items': [], 'grades': [], 'entries': [], 'homework': [], 'remarks': [], 'slots': []});
      }
    });
    final a = ApiClient(baseUrl: 'https://api.test', client: client);
    await a.login('30000000', 'x');
    return a;
  }

  Widget app(Widget home) => MaterialApp(theme: oceanTheme(arabic: false), home: home);

  for (final (nom, taille) in [('petit téléphone', const Size(360, 640)), ('téléphone courant', const Size(393, 852)), ('tablette', const Size(800, 1280))]) {
    testWidgets('la coquille et le tableau de bord tiennent sur $nom', (tester) async {
      tester.view.physicalSize = taille;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final a = await api();
      await tester.pumpWidget(app(ParentShell(api: a, onSignedOut: () {}, locale: const Locale('fr'), onLocaleChanged: (_) {})));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
      expect(tester.takeException(), isNull, reason: 'aucun débordement sur $nom');
      expect(find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Fatimetou')), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Mohamed Abdellahi')), findsWidgets);
      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('la fiche d’un enfant tient sur $nom', (tester) async {
      tester.view.physicalSize = taille;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final a = await api();
      final enfant = Child.fromJson(enfants[0]);
      await tester.pumpWidget(app(ChildScreen(api: a, child: enfant, lang: 'fr')));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
      expect(tester.takeException(), isNull, reason: 'aucun débordement sur $nom');
      expect(find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Ould Cheikh')), findsWidgets);
    });

    testWidgets('le fil des notifications tient sur $nom', (tester) async {
      tester.view.physicalSize = taille;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final a = await api();
      await tester.pumpWidget(app(NotificationsScreen(api: a, lang: 'fr')));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
      expect(tester.takeException(), isNull, reason: 'aucun débordement sur $nom');
      expect(find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Mathématiques')), findsWidgets);
    });
  }
}
