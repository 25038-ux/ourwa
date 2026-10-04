import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/documents_screen.dart';
import 'package:elourwa_parent/src/parent_shell.dart';
import 'package:elourwa_parent/src/theme.dart';

/// LES DOCUMENTS SIGNÉS (ADR-0080) dans l'application : chaque pièce de chaque
/// enfant, « Disponible » ou « En attente » ; en français et en arabe (de
/// droite à gauche) ; LECTURE SEULE ; la dernière liste reste lisible hors
/// ligne ; l'entrée « Documents » du menu latéral n'existe que pour une école
/// « services ».
void main() {
  http.Response jsonRes(Object body, [int code = 200]) =>
      http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});

  final documents = {
    'actif': true,
    'annee': {'id': 'y', 'label': '2026-2027'},
    'enfants': [
      {
        'id': 'e1',
        'prenom': 'Aminetou',
        'nom': 'Ould Abdallahi',
        'matricule': 'ET26001',
        'classe': '1 AF — 1 AF A',
        'pieces': [
          {
            'piece': 'inscription',
            'libelle': 'Inscription',
            'souscrit': true,
            'document': {'id': 'd1', 'nom': 'inscription signée.pdf', 'mime': 'application/pdf', 'octets': 120000, 'deposeLe': '2026-10-04T10:00:00Z', 'deposePar': null},
          },
          {'piece': 'comportement_social', 'libelle': 'Comportements sociaux', 'souscrit': false, 'document': null},
          {'piece': 'piscine', 'libelle': 'Piscine', 'souscrit': true, 'document': null},
        ],
      },
    ],
  };

  Future<ApiClient> api({bool horsLigne = false, bool actif = true}) async {
    FlutterSecureStorage.setMockInitialValues({});
    final client = MockClient((req) async {
      switch (req.url.path) {
        case '/auth/login':
          return jsonRes({'accessToken': 'a', 'refreshToken': 'r', 'user': {'mustChangePassword': false, 'locale': 'fr'}, 'ecoles': [
            {'id': 's0', 'slug': 'jinan', 'name': 'Jinan', 'nameAr': 'جنان'},
          ]}, 201);
        case '/parent/documents':
          if (horsLigne) throw http.ClientException('réseau absent');
          return jsonRes({...documents, 'actif': actif});
        case '/parent/children':
          return jsonRes({'academicYear': '2026-2027', 'guardianName': 'Mohamed Ould Abdallahi', 'ecoles': ['a'], 'children': []});
        case '/parent/messages/unread':
        case '/parent/notifications/unread':
          return jsonRes({'count': 0});
        default:
          return jsonRes({'items': [], 'grades': [], 'entries': [], 'homework': [], 'remarks': [], 'slots': [], 'messages': []});
      }
    });
    final a = ApiClient(baseUrl: 'https://api.test', client: client);
    await a.login('36123456', 'x');
    return a;
  }

  Widget app(Widget home, {String lang = 'fr'}) => MaterialApp(
        theme: oceanTheme(arabic: lang == 'ar'),
        locale: Locale(lang),
        home: Directionality(
          textDirection: lang == 'ar' ? TextDirection.rtl : TextDirection.ltr,
          child: Scaffold(body: home),
        ),
      );

  Future<void> laisser(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  bool texte(Widget w, String s) => w is RichText && w.text.toPlainText().contains(s);

  testWidgets('chaque pièce de chaque enfant, disponible ou en attente', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final a = await api();
    await tester.pumpWidget(app(DocumentsScreen(api: a, lang: 'fr')));
    await laisser(tester);
    expect(tester.takeException(), isNull);
    expect(find.byWidgetPredicate((w) => texte(w, 'Aminetou Ould Abdallahi')), findsOneWidget);
    expect(find.byWidgetPredicate((w) => texte(w, 'Inscription')), findsOneWidget);
    expect(find.byWidgetPredicate((w) => texte(w, 'Disponible · Déposé le 04/10/2026')), findsOneWidget);
    expect(find.byWidgetPredicate((w) => texte(w, 'En attente')), findsNWidgets(2));
    expect(find.byWidgetPredicate((w) => texte(w, '1 / 3')), findsOneWidget);
  });

  testWidgets('⚠ lecture seule : ni « Supprimer », ni « Remplacer », ni « Déposer »', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final a = await api();
    await tester.pumpWidget(app(DocumentsScreen(api: a, lang: 'fr')));
    await laisser(tester);
    for (final mot in ['Supprimer', 'Remplacer', 'Déposer', 'Modifier']) {
      expect(find.byWidgetPredicate((w) => texte(w, mot)), findsNothing, reason: mot);
    }
    // Ouvrir et télécharger, oui.
    expect(find.byTooltip('Ouvrir'), findsOneWidget);
    expect(find.byTooltip('Télécharger'), findsOneWidget);
  });

  testWidgets('en arabe, de droite à gauche, sans débordement', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final a = await api();
    await tester.pumpWidget(app(DocumentsScreen(api: a, lang: 'ar'), lang: 'ar'));
    await laisser(tester);
    expect(tester.takeException(), isNull);
    expect(find.byWidgetPredicate((w) => texte(w, 'الوثائق')), findsWidgets);
    expect(find.byWidgetPredicate((w) => texte(w, 'قيد الانتظار')), findsNWidgets(2));
  });

  testWidgets('hors ligne : la dernière liste enregistrée reste lisible', (tester) async {
    SharedPreferences.setMockInitialValues({DocumentsScreen.cleCache: jsonEncode(documents)});
    final a = await api(horsLigne: true);
    await tester.pumpWidget(app(DocumentsScreen(api: a, lang: 'fr')));
    await laisser(tester);
    expect(find.byWidgetPredicate((w) => texte(w, 'Aminetou Ould Abdallahi')), findsOneWidget);
    expect(find.byWidgetPredicate((w) => texte(w, 'Hors ligne')), findsOneWidget);
  });

  testWidgets('le menu latéral : « Documents » pour une école « services », pas pour une autre', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    for (final actif in [true, false]) {
      SharedPreferences.setMockInitialValues({});
      final a = await api(actif: actif);
      await tester.pumpWidget(MaterialApp(
        theme: oceanTheme(arabic: false),
        home: ParentShell(key: ValueKey(actif), api: a, onSignedOut: () {}, locale: const Locale('fr'), onLocaleChanged: (_) {}),
      ));
      await laisser(tester);
      await tester.tap(find.byTooltip('Menu'));
      await laisser(tester);
      expect(find.byType(Drawer), findsOneWidget);
      expect(find.byWidgetPredicate((w) => texte(w, 'Documents')), actif ? findsOneWidget : findsNothing, reason: 'actif=$actif');
      expect(find.byWidgetPredicate((w) => texte(w, 'Remarques')), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}
