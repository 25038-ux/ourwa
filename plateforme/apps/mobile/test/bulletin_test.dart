import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elourwa_parent/src/api.dart';
import 'package:elourwa_parent/src/report_card_screen.dart';
import 'package:elourwa_parent/src/theme.dart';

/// LE BULLETIN DESSINÉ (décision du propriétaire, 20/09) : la mise en page du
/// site, en widgets. Il tient sur la largeur minimale du document (560 dp) et
/// dit ce que le site dit — le titre, une absence en toutes lettres, la
/// décision — sans jamais rendre « -1 ».
void main() {
  final carte = ReportCard.fromJson({
    'regime': 'classic',
    'term': 1,
    'academicYear': '2025-2026',
    'student': {'matricule': 'ET2510001', 'group_name': '6ème A', 'level_name': 'Sixième', 'guardian_name': 'Fatimetou Mint Ahmed'},
    'formula': {'courseworkWeight': '2', 'examWeight': '3', 'divisor': '5'},
    'passMark': '10.00',
    'subjects': [
      {'subject': 'Mathématiques appliquées', 'coefficient': 3, 'maxScore': '20', 'courseworkMarks': ['12', '14.5'], 'coursework': '13.25', 'exam': '10', 'mark': '11.30', 'markOutOf20': '11.30', 'absent': false},
      {'subject': 'Arabe', 'coefficient': 2, 'maxScore': '20', 'courseworkMarks': [], 'coursework': null, 'exam': null, 'mark': null, 'markOutOf20': null, 'absent': true},
      {'subject': 'Éducation islamique', 'coefficient': 1, 'maxScore': '20', 'courseworkMarks': ['8'], 'coursework': '8.00', 'exam': '7', 'mark': '7.40', 'markOutOf20': '7.40', 'absent': false},
    ],
    'average': '9.75',
    'band': 'Insuffisant',
    'totalCoefficients': 4,
    'termRecap': ['9.75', null, null],
    'termRecapFondamental': [],
    'annualAverage': null,
    'annualFondamental': null,
    'verdict': {'status': 'ajourne', 'label': 'Ajourné', 'labelAr': 'راسب', 'cssClass': 'bul-fail'},
    'annualVerdict': null,
    'withheld': false,
  });
  final enfant = Child.fromJson(const {
    'id': 'e1', 'first_name': 'Mohamed Abdellahi', 'last_name': 'Ould Cheikh Sidi Mohamed', 'group_name': '6ème A', 'level_name': 'Sixième',
    'is_free': false, 'absences': 2, 'average': '9.75', 'examsWithheld': false,
    'school': {'id': 's', 'slug': 'nour', 'name': 'École Nour', 'nameAr': 'مدرسة النور'},
  });

  for (final largeur in [560.0, 720.0, 960.0]) {
    testWidgets('le document tient sur $largeur dp et dit ce que le site dit', (tester) async {
      tester.view.physicalSize = Size(largeur + 40, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: oceanTheme(arabic: false),
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(width: largeur, child: BulletinOfficiel(card: carte, ecole: 'École Nour', eleve: enfant)),
          ),
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'aucun débordement à $largeur');
      expect(find.text('BULLETIN DE NOTES'), findsOneWidget);
      expect(find.text('Absent'), findsOneWidget);
      expect(find.textContaining('Ajourné'), findsWidgets);
      expect(find.text('12 · 14.5'), findsOneWidget);
      expect(find.textContaining('-1'), findsNothing);
      expect(find.textContaining("Seuil d'admission : 10,00 / 20"), findsOneWidget);
    });
  }
}
