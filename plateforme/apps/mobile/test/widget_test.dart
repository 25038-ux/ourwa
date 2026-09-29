import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elourwa_parent/src/parent_shell.dart' show salutation;
import 'package:elourwa_parent/src/dashboard_screen.dart' show formatAverage;
import 'package:elourwa_parent/src/i18n.dart';
import 'package:elourwa_parent/main.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/messages_screen.dart';

void main() {
  modelTests();

  testWidgets('supports both French and Arabic', (tester) async {
    await tester.pumpWidget(const ParentApp());
    await tester.pump();
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.supportedLocales, contains(const Locale('ar')));
    expect(app.supportedLocales, contains(const Locale('fr')));
  });
}

void modelTests() {
  test('a report card keeps marks as strings, never doubles', () {
    final card = ReportCard.fromJson(const {
      'regime': 'classic',
      'term': 1,
      'academicYear': '2025-2026',
      'average': '14.00',
      'band': 'Bien',
      'subjects': [
        {
          'subject': 'Mathematiques',
          'coefficient': 4,
          'maxScore': '20.00',
          'coursework': '16.45',
          'exam': '14.96',
          'mark': '15.56',
          'markOutOf20': '15.56',
          'absent': false,
        },
      ],
    });
    // Parsing to double here would reintroduce the precision loss the backend
    // exists to avoid.
    expect(card.subjects.first.mark, isA<String>());
    expect(card.subjects.first.mark, '15.56');
    expect(card.isFondamental, isFalse);
  });

  test('a fondamental card carries a total, not an average', () {
    final card = ReportCard.fromJson(const {
      'regime': 'fondamental',
      'term': 1,
      'academicYear': '2025-2026',
      'points': '50.00',
      'outOf': '80.00',
      'average': null,
      'subjects': <Map<String, dynamic>>[],
    });
    expect(card.isFondamental, isTrue);
    expect(card.average, isNull);
    expect(card.points, '50.00');
  });

  test('an absent subject is flagged rather than scored zero', () {
    final row = SubjectRow.fromJson(const {
      'subject': 'Arabe',
      'coefficient': 3,
      'maxScore': '20.00',
      'coursework': null,
      'exam': null,
      'mark': null,
      'markOutOf20': null,
      'absent': true,
    });
    expect(row.absent, isTrue);
    expect(row.mark, isNull);
  });

  test('an unopened message is distinguishable from one opened at an unknown time', () {
    // `read_at` is nullable and stays nullable. Collapsing it to a boolean
    // would lose the only figure the school actually reports on: WHEN a family
    // first opened an announcement.
    final unread = SchoolMessage.fromJson(const {
      'id': '01a05000-0000-7000-8000-000000000001',
      'sender_name': 'Direction',
      'subject': 'Rentrée',
      'body': 'Les cours reprennent le 1er octobre.',
      'sent_at': '2026-09-20T09:00:00.000Z',
      'read_at': null,
    });
    expect(unread.unread, isTrue);
    expect(unread.readAt, isNull);

    final read = SchoolMessage.fromJson(const {
      'id': '01a05000-0000-7000-8000-000000000002',
      'sender_name': 'Direction',
      'subject': 'Réunion',
      'body': 'Mardi à 10h.',
      'sent_at': '2026-09-20T09:00:00.000Z',
      'read_at': '2026-09-21T18:30:00.000Z',
    });
    expect(read.unread, isFalse);
    expect(read.readAt, isNotNull);
  });

  test('a message survives a payload with missing text fields', () {
    // The list must render even if a field arrives null: a crash here hides
    // every other message the family has.
    final sparse = SchoolMessage.fromJson(const {
      'id': '01a05000-0000-7000-8000-000000000003',
      'sender_name': null,
      'subject': null,
      'body': null,
      'sent_at': '',
      'read_at': null,
    });
    expect(sparse.subject, '');
    expect(sparse.sentAt, isNull);
  });

  test('a withheld report card is not mistaken for an empty one', () {
    // ⚠ "No marks yet" and "we are holding your child's results because you owe
    // us money" are entirely different messages to a parent. The API sends a
    // COMPLETE shape with `withheld: true` and no subjects; a client that read
    // the empty list alone would show the wrong one.
    final card = ReportCard.fromJson({
      'regime': 'classic',
      'term': 2,
      'academicYear': '2026-2027',
      'subjects': <dynamic>[],
      'average': null,
      'withheld': true,
      'reason': 'Les résultats de ce trimestre sont retenus.',
    });

    expect(card.withheld, isTrue);
    expect(card.subjects, isEmpty);
    expect(card.reason, contains('retenus'));
    expect(card.term, 2);
  });

  test('an ordinary empty term is not treated as withheld', () {
    final card = ReportCard.fromJson({
      'regime': 'classic',
      'term': 1,
      'academicYear': '2026-2027',
      'subjects': <dynamic>[],
    });
    expect(card.withheld, isFalse);
    expect(card.reason, isNull);
  });

  test('survives a payload missing the fields it used to require', () {
    // The screen must explain itself rather than throw: a family shown a crash
    // concludes the school has lost their child's marks.
    final card = ReportCard.fromJson({'subjects': <dynamic>[]});
    expect(card.regime, 'classic');
    expect(card.term, 1);
    expect(card.academicYear, '');
  });

  group("El Ourwa's own words", () {
    test('the parent identifier is a phone, not an email', () {
      // `identifiant` is "Téléphone" in its table. A family in Nouakchott has a
      // phone; assuming an email would lock most of them out.
      expect(t('identifiant', 'fr'), 'Téléphone');
      expect(t('identifiant', 'ar'), 'الهاتف');
    });

    test('the seven navigation labels exist in both languages', () {
      for (final key in [
        'accueil',
        'resultats',
        'absences',
        'remarques',
        'exercices',
        'messages',
        'profil',
      ]) {
        expect(kStrings[key]?['fr'], isNotNull, reason: '$key fr');
        expect(kStrings[key]?['ar'], isNotNull, reason: '$key ar');
      }
    });

    test('the school name is written in Arabic, not transliterated', () {
      expect(t('app_nom', 'fr'), 'El Ourwa');
      expect(t('app_nom', 'ar'), 'العروة');
    });

    test('a missing key shows itself rather than a blank', () {
      // Visible in testing, harmless in front of a parent — unlike an empty
      // space, which reads as a broken screen.
      expect(t('pas_une_cle', 'fr'), 'pas_une_cle');
    });

    test('an unknown language falls back to French, never to nothing', () {
      expect(t('accueil', 'es'), 'Accueil');
    });
  });

  group("its hour-aware greeting", () {
    // ⚠ FOUR BANDS IN FRENCH, THREE IN ARABIC, and the Arabic is NOT a
    // translation of the French: night and evening share مساء الخير, while
    // French distinguishes "Bonne nuit" from "Bonsoir". Ported as its own
    // conditional because the branching IS the content.
    DateTime at(int h) => DateTime(2026, 9, 1, h);

    test('French: four bands, its own boundaries', () {
      expect(salutation('fr', at(3)), 'Bonne nuit');
      expect(salutation('fr', at(9)), 'Bonjour');
      expect(salutation('fr', at(14)), 'Bon après-midi');
      expect(salutation('fr', at(21)), 'Bonsoir');
    });

    test('the boundaries fall exactly where its conditional puts them', () {
      expect(salutation('fr', at(4)), 'Bonne nuit');
      expect(salutation('fr', at(5)), 'Bonjour');
      expect(salutation('fr', at(11)), 'Bonjour');
      expect(salutation('fr', at(12)), 'Bon après-midi');
      expect(salutation('fr', at(17)), 'Bon après-midi');
      expect(salutation('fr', at(18)), 'Bonsoir');
    });

    test('⚠ Arabic shares one greeting between night and evening', () {
      expect(salutation('ar', at(3)), 'مساء الخير');
      expect(salutation('ar', at(9)), 'صباح الخير');
      expect(salutation('ar', at(14)), 'مرحباً');
      expect(salutation('ar', at(21)), 'مساء الخير');
      // The two that share it really are the same string.
      expect(salutation('ar', at(3)), salutation('ar', at(21)));
      // Where French does not.
      expect(salutation('fr', at(3)), isNot(salutation('fr', at(21))));
    });
  });

  group("its average formatting", () {
    // ⚠ `rtrim(rtrim(number_format($m, 2, ',', ''), '0'), ',')` — two decimals,
    // then trailing zeros go, then a trailing comma. A whole mark prints as
    // "10", not "10,00": the second reads as something a machine computed, the
    // first as a mark a child was given.
    test('two decimals, trailing zeros stripped', () {
      expect(formatAverage('9.56'), '9,56');
      expect(formatAverage('10.00'), '10');
      expect(formatAverage('10.50'), '10,5');
      expect(formatAverage('0.00'), '0');
      expect(formatAverage('12.30'), '12,3');
    });

    test('a comma decimal separator, never a point', () {
      expect(formatAverage('7.25'), contains(','));
      expect(formatAverage('7.25'), isNot(contains('.')));
    });

    test('rounds to two before stripping, as number_format does', () {
      expect(formatAverage('9.999'), '10');
      expect(formatAverage('9.994'), '9,99');
    });
  });

  group("the string table", () {
    // ⚠ I re-added two keys that the extraction already had. Dart catches a
    // duplicate in a const map at compile time, but only once someone compiles;
    // this fails the moment it happens and says which key.
    test('every key resolves in both languages', () {
      for (final key in kStrings.keys) {
        expect(t(key, 'fr'), isNotEmpty, reason: 'French missing for $key');
        expect(t(key, 'ar'), isNotEmpty, reason: 'Arabic missing for $key');
      }
    });

    test('carries the parent space, not a subset of it', () {
      // The screens the app actually renders, each needing its own words.
      for (final key in [
        'hero_titre_l1', 'hero_titre_l2', 'bonjour', 'connectez_vous',
        'accueil', 'resultats', 'exercices', 'absences', 'messages', 'profil',
        'examens_bloques_titre', 'sans_annee_titre',
        'a_rendre_avant', 'date_depassee', 'absent', 'retard',
      ]) {
        expect(kStrings.containsKey(key), isTrue, reason: 'missing $key');
      }
    });
  });
}
