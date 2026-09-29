import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'api.dart';

/// LE BULLETIN EN PDF — DESSINÉ SUR LE TÉLÉPHONE, SANS NAVIGATEUR.
///
/// ⚠ « THE BULLETINS IS NOT DOWNLOADABLE » (propriétaire, 23/09/2026). Le PDF
/// était obtenu en convertissant le HTML du site par la vue web du téléphone
/// (`Printing.convertHtml`, obsolète) : sur les téléphones sans vue web à
/// jour, ou quand le système la coupe, la conversion échoue et l'application
/// ne pouvait qu'afficher « Erreur de communication » — sans qu'il y ait eu
/// la moindre communication. Ici le document est composé en widgets PDF à
/// partir des MÊMES chiffres que l'écran (`ReportCard`, tout faits par le
/// serveur), avec la mise en page de `bulletin_vue.php` : en-tête tricolonne
/// bilingue, bandeau de titre, six lignes, le tableau avec sa ligne d'en-tête
/// arabe au-dessus de la française, le pied et la mise en garde. Mêmes
/// couleurs que le site (`bulletin-css.ts`).
///
/// ⚠ CHAQUE RUN ARABE EST COMPOSÉ À PART, avec Noto Sans Arabic (qui voyage
/// avec l'application) comme police PRINCIPALE et sous une `Directionality`
/// RTL. Une ligne mixte confiée à Helvetica avec Noto en repli sort lettre
/// par lettre, non liée et à l'envers : le paquet `pdf` ne façonne l'arabe
/// que sous une direction RTL et ne découpe les runs qu'en glyphes isolés.
/// D'où [_Mixte] : latin et arabe côte à côte, chacun dans sa police et sa
/// direction. Rien n'est téléchargé.
Future<Uint8List> bulletinPdf(ReportCard card, String ecole, Child eleve) async {
  final arabe = pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSansArabic.ttf'));
  final latin = pw.Font.helvetica();
  final latinGras = pw.Font.helveticaBold();
  final latinItalique = pw.Font.helveticaOblique();
  final base = pw.TextStyle(font: latin, fontSize: 9.5, color: _encre);
  final gras = base.copyWith(font: latinGras, fontBold: latinGras);

  final s = card.student ?? const <String, dynamic>{};
  final fond = card.isFondamental;
  final seuil = double.tryParse(card.passMark) ?? 10;
  final verdict = card.verdict;
  final verdictAnnee = card.annualVerdict;
  final verdictAffiche = !card.withheld && verdict != null;

  // Un run arabe : Noto en police principale, direction RTL.
  pw.Widget ar(String texte, {double taille = 9.5, bool grasse = false, PdfColor couleur = _encre, pw.TextAlign align = pw.TextAlign.right}) =>
      pw.Directionality(
        textDirection: pw.TextDirection.rtl,
        child: pw.Text(texte, textAlign: align, style: pw.TextStyle(font: arabe, fontSize: taille, color: couleur, fontWeight: grasse ? pw.FontWeight.bold : pw.FontWeight.normal)),
      );

  // Un texte dont on ne sait pas la langue (nom de l'école, de l'élève, du
  // correspondant, libellé d'une matière) : arabe s'il contient de l'arabe.
  pw.Widget texte(String t, {double taille = 9.5, bool grasse = false, PdfColor couleur = _encre, pw.TextAlign align = pw.TextAlign.left}) =>
      _contientArabe(t)
          ? ar(t, taille: taille, grasse: grasse, couleur: couleur, align: align == pw.TextAlign.left ? pw.TextAlign.right : align)
          : pw.Text(t, textAlign: align, style: pw.TextStyle(font: grasse ? latinGras : latin, fontSize: taille, color: couleur));

  // Une ligne mixte : latin puis arabe (ou l'inverse), chacun dans sa police.
  pw.Widget mixte(List<pw.Widget> morceaux, {pw.MainAxisAlignment align = pw.MainAxisAlignment.start}) =>
      pw.Row(mainAxisSize: pw.MainAxisSize.min, mainAxisAlignment: align, crossAxisAlignment: pw.CrossAxisAlignment.center, children: morceaux);

  pw.Widget infos(List<(String, String, String, bool)> lignes) {
    pw.Widget ligne((String, String, String, bool) l) => pw.Container(
          padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
          decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: PdfColor.fromInt(0xFFE0E0E0), width: .5))),
          child: pw.Row(children: [
            pw.SizedBox(width: 62, child: ar(l.$1, taille: 8.5, couleur: _gris)),
            pw.Text(' | ', style: base.copyWith(color: const PdfColor.fromInt(0xFFBBBBBB))),
            pw.SizedBox(width: 74, child: pw.Text(l.$2, style: base.copyWith(fontSize: 8.5, color: _gris))),
            pw.Expanded(child: texte(l.$3, taille: 9, grasse: true)),
          ]),
        );
    return pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      pw.Expanded(child: pw.Column(children: [for (var i = 0; i < lignes.length; i += 2) ligne(lignes[i])])),
      pw.SizedBox(width: 8),
      pw.Expanded(child: pw.Column(children: [for (var i = 1; i < lignes.length; i += 2) ligne(lignes[i])])),
    ]);
  }

  // ── Le tableau ────────────────────────────────────────────────────────────
  final cw = _coef(card.formula?['courseworkWeight'], '2');
  final ex = _coef(card.formula?['examWeight'], '3');
  final dv = _coef(card.formula?['divisor'], '5');

  pw.Widget th(String texte, {bool arabeTexte = false, PdfColor fondCase = _bleuNuit, PdfColor couleur = PdfColors.white, String? petit}) => pw.Container(
        decoration: pw.BoxDecoration(color: fondCase, border: pw.Border.all(color: const PdfColor.fromInt(0xFF888888), width: .5)),
        padding: const pw.EdgeInsets.symmetric(vertical: 3, horizontal: 2),
        alignment: pw.Alignment.center,
        child: pw.Column(children: [
          arabeTexte
              ? ar(texte, taille: 7.5, grasse: true, couleur: couleur, align: pw.TextAlign.center)
              : pw.Text(texte.toUpperCase(), textAlign: pw.TextAlign.center, style: pw.TextStyle(font: latinGras, fontSize: 7, color: couleur)),
          if (petit != null) pw.Text(petit, style: pw.TextStyle(font: latin, fontSize: 6.5, color: couleur)),
        ]),
      );
  pw.Widget td(String t, {bool gauche = false, PdfColor? couleur, bool grasse = false, double taille = 9, PdfColor? fondCase}) => pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: _filet, width: .5), color: fondCase),
        padding: pw.EdgeInsets.fromLTRB(gauche ? 6 : 3, 3, 3, 3),
        alignment: gauche ? pw.Alignment.centerLeft : pw.Alignment.center,
        child: texte(t, taille: taille, grasse: grasse, couleur: couleur ?? _encre, align: gauche ? pw.TextAlign.left : pw.TextAlign.center),
      );

  final largeurs = fond
      ? {0: const pw.FlexColumnWidth(2.2), 1: const pw.FlexColumnWidth(1.6), 2: const pw.FlexColumnWidth(1.1), 3: const pw.FlexColumnWidth(1), 4: const pw.FlexColumnWidth(1.1), 5: const pw.FlexColumnWidth(.9)}
      : {0: const pw.FlexColumnWidth(2.2), 1: const pw.FlexColumnWidth(1.6), 2: const pw.FlexColumnWidth(1.1), 3: const pw.FlexColumnWidth(1), 4: const pw.FlexColumnWidth(1.1), 5: const pw.FlexColumnWidth(.8), 6: const pw.FlexColumnWidth(.9)};
  const noir = PdfColor.fromInt(0xFF222222);
  final enteteAr = fond
      ? [th('المواد', arabeTexte: true), th('الفروض', arabeTexte: true), th('متوسط الفروض', arabeTexte: true), th('الامتحان', arabeTexte: true), th('المعدل ÷2', arabeTexte: true), th('السلّم', arabeTexte: true)]
      : [th('المواد', arabeTexte: true), th('الفروض', arabeTexte: true), th('متوسط الفروض', arabeTexte: true, petit: '× $cw'), th('الامتحان', arabeTexte: true, petit: '× $ex'), th('المعدل', arabeTexte: true, petit: '÷ $dv'), th('المعامل', arabeTexte: true), th('المجموع', arabeTexte: true)];
  final enteteFr = fond
      ? [th('Matière', fondCase: _bleuClair, couleur: noir), th('Devoirs', fondCase: _bleuClair, couleur: noir), th('Moy. Devoirs', fondCase: _bleuClair, couleur: noir), th('Examen', fondCase: _bleuClair, couleur: noir), th('Moyenne (÷2)', fondCase: _bleuClair, couleur: noir), th('Notée sur', fondCase: _bleuClair, couleur: noir)]
      : [th('Matière', fondCase: _bleuClair, couleur: noir), th('Devoirs', fondCase: _bleuClair, couleur: noir), th('Moy. Devoirs', fondCase: _bleuClair, couleur: noir, petit: '× $cw'), th('Examen', fondCase: _bleuClair, couleur: noir, petit: '× $ex'), th('Moyenne', fondCase: _bleuClair, couleur: noir, petit: '÷ $dv'), th('Coeff.', fondCase: _bleuClair, couleur: noir), th('Total', fondCase: _bleuClair, couleur: noir)];

  final lignes = <pw.TableRow>[pw.TableRow(children: enteteAr), pw.TableRow(children: enteteFr)];
  for (final (i, sr) in card.subjects.indexed) {
    final moy = sr.mark == null ? null : double.tryParse(sr.mark!);
    final total = sr.total ?? (moy == null ? null : (moy * sr.coefficient).toStringAsFixed(2));
    final fondCase = i.isOdd ? const PdfColor.fromInt(0xFFF8F8F8) : PdfColors.white;
    final devoirs = sr.courseworkMarks.isEmpty ? '—' : sr.courseworkMarks.join(' · ');
    lignes.add(pw.TableRow(children: [
      td(sr.subject, gauche: true, grasse: true, fondCase: fondCase),
      td(devoirs, taille: 8, fondCase: fondCase),
      td(sr.coursework ?? '—', fondCase: fondCase),
      td(sr.exam ?? '—', fondCase: fondCase),
      if (fond) ...[
        td(sr.absent ? 'Absent' : (sr.mark ?? '—'), grasse: true, couleur: _vertEcole, fondCase: fondCase),
        td('/ ${_coef(sr.maxScore, '20')}', fondCase: fondCase),
      ] else ...[
        td(sr.absent ? 'Absent' : (sr.mark ?? '—'), grasse: true, taille: 10, couleur: moy == null ? null : (moy >= seuil ? _admis : _ajourne), fondCase: fondCase),
        td('${sr.coefficient}', fondCase: fondCase),
        td(total ?? '—', grasse: true, fondCase: fondCase),
      ],
    ]));
  }
  final verdictCouleur = verdictAffiche && card.verdict != null ? (card.verdict!.status == 'admis' ? _admis : card.verdict!.status == 'ajourne' ? _ajourne : null) : null;
  final outOf = double.tryParse(card.outOf ?? '0') ?? 0;
  final pts = double.tryParse(card.points ?? '0') ?? 0;
  final totalCoef = card.totalCoefficients ?? card.subjects.where((x) => x.mark != null).fold<int>(0, (n, x) => n + x.coefficient);
  const piedFond = PdfColor.fromInt(0xFFF0F0F0);

  final tableau = pw.Column(children: [
    pw.Table(columnWidths: largeurs, defaultVerticalAlignment: pw.TableCellVerticalAlignment.middle, children: lignes),
    pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(color: const PdfColor.fromInt(0xFF888888), width: .5)),
      child: pw.Row(children: [
        pw.Expanded(
          child: pw.Container(
            color: piedFond,
            padding: const pw.EdgeInsets.symmetric(vertical: 5, horizontal: 6),
            alignment: pw.Alignment.centerRight,
            child: mixte([
              ar(fond ? 'المجموع العام' : 'المعدل العام', taille: 8.5, grasse: true),
              pw.Text(fond ? ' | TOTAL GÉNÉRAL' : ' | Moyenne Générale', style: gras.copyWith(fontSize: 8.5)),
            ], align: pw.MainAxisAlignment.end),
          ),
        ),
        if (!fond)
          pw.Container(width: 46, color: piedFond, padding: const pw.EdgeInsets.symmetric(vertical: 5), alignment: pw.Alignment.center, child: pw.Text('$totalCoef', style: gras)),
        pw.Container(
          width: 84,
          color: _bleuNuit,
          padding: const pw.EdgeInsets.symmetric(vertical: 5),
          alignment: pw.Alignment.center,
          child: pw.Text(fond ? (outOf > 0 ? '${card.points} / ${_coef(card.outOf, '0')}' : '—') : (card.average ?? 'N/A'), style: pw.TextStyle(font: latinGras, fontSize: 11.5, color: PdfColors.white)),
        ),
      ]),
    ),
    if (!fond && verdictCouleur != null) pw.Container(height: 2.5, color: verdictCouleur, margin: const pw.EdgeInsets.only(top: 1)),
    if (fond && outOf > 0) pw.Container(height: 2.5, color: pts / outOf >= .5 ? _admis : _ajourne, margin: const pw.EdgeInsets.only(top: 1)),
  ]);

  // ── Le pied ───────────────────────────────────────────────────────────────
  const griseTitre = PdfColor.fromInt(0xFF333333);
  pw.TextStyle stTitre() => pw.TextStyle(font: latinGras, fontSize: 8, color: griseTitre);
  pw.Widget cadreTitre(pw.Widget enfant) => pw.Container(
        margin: const pw.EdgeInsets.only(bottom: 5),
        padding: const pw.EdgeInsets.only(bottom: 2),
        decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: PdfColor.fromInt(0xFFCCCCCC), width: .5))),
        child: enfant,
      );
  pw.Widget ligneResultat(String libelle, String valeur, PdfColor? couleur, {bool grasse = false, String? libelleAr}) => pw.Padding(
        padding: const pw.EdgeInsets.only(bottom: 2),
        child: pw.Wrap(crossAxisAlignment: pw.WrapCrossAlignment.center, spacing: 5, children: [
          pw.Text(libelle, style: pw.TextStyle(font: grasse ? latinGras : latin, fontSize: 8.5, color: _gris)),
          if (libelleAr != null) ar(libelleAr, taille: 8.5, grasse: grasse, couleur: _gris),
          pw.Text(valeur, style: pw.TextStyle(font: latinGras, fontSize: grasse ? 11 : 9.5, color: couleur ?? _encre)),
        ]),
      );
  PdfColor? couleurSeuil(String? valeur) {
    final v = valeur == null ? null : double.tryParse(valeur);
    if (v == null) return null;
    return v >= seuil ? _admis : _ajourne;
  }

  String? equiv20(Map<String, dynamic> rf) {
    final sur = double.tryParse('${rf['outOf']}') ?? 0;
    final p = double.tryParse('${rf['points']}') ?? 0;
    return sur > 0 ? (p * 20 / sur).toStringAsFixed(2) : null;
  }

  pw.Widget badge(Verdict v) {
    final (texteCouleur, fondBadge) = switch (v.status) {
      'admis' => (const PdfColor.fromInt(0xFF065F46), const PdfColor.fromInt(0xFFD1FAE5)),
      'ajourne' => (const PdfColor.fromInt(0xFF991B1B), const PdfColor.fromInt(0xFFFEE2E2)),
      _ => (const PdfColor.fromInt(0xFF4B5563), const PdfColor.fromInt(0xFFF3F4F6)),
    };
    return pw.Container(
      padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: pw.BoxDecoration(color: fondBadge, borderRadius: pw.BorderRadius.circular(3)),
      child: mixte([
        pw.Text('${v.label} ', style: pw.TextStyle(font: latinGras, fontSize: 9, color: texteCouleur)),
        ar(v.labelAr, taille: 9, grasse: true, couleur: texteCouleur),
      ]),
    );
  }

  final resultats = pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
    cadreTitre(mixte([pw.Text('Résultats / ', style: stTitre()), ar('النتائج', taille: 8, grasse: true, couleur: griseTitre)])),
    if (fond)
      for (final (i, rf) in card.termRecapFondamental.indexed)
        ligneResultat('Total — ${i + 1}${_ordinal(i + 1)} trimestre :', rf == null ? '—' : '${rf['points']} / ${_coef(rf['outOf'], '0')}', rf == null ? null : couleurSeuil(equiv20(rf)))
    else
      for (final (i, mg) in card.termRecap.indexed)
        ligneResultat('Moyenne Générale — ${i + 1}${_ordinal(i + 1)} trimestre :', mg == null ? '—' : '$mg / 20', couleurSeuil(mg)),
    if (card.annualAverage != null || card.annualFondamental != null)
      pw.Container(
        margin: const pw.EdgeInsets.only(top: 3),
        padding: const pw.EdgeInsets.only(top: 3),
        decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: _vertEcole, width: 1.2))),
        child: ligneResultat(
          "Moyenne Générale de l'Année :",
          card.annualFondamental != null ? '${card.annualFondamental!['points']} / ${_coef(card.annualFondamental!['outOf'], '0')}' : '${card.annualAverage} / 20',
          verdictAnnee == null ? null : (verdictAnnee.status == 'admis' ? _admis : verdictAnnee.status == 'ajourne' ? _ajourne : null),
          grasse: true,
          libelleAr: 'المعدل السنوي',
        ),
      ),
    if (verdictAffiche) ...[
      pw.SizedBox(height: 3),
      ligneResultat('Appréciation (${card.term}${_ordinal(card.term)} trim.) :', card.band ?? '', verdict.status == 'admis' ? _admis : verdict.status == 'ajourne' ? _ajourne : null),
      pw.SizedBox(height: 3),
      pw.Wrap(crossAxisAlignment: pw.WrapCrossAlignment.center, spacing: 5, children: [
        pw.Text(verdictAnnee != null ? 'Décision annuelle :' : 'Résultat du trimestre :', style: base.copyWith(fontSize: 8.5, color: _gris)),
        ar(verdictAnnee != null ? 'القرار السنوي' : 'نتيجة الفصل', taille: 8.5, couleur: _gris),
        badge(verdictAnnee ?? verdict),
      ]),
      pw.Padding(
        padding: const pw.EdgeInsets.only(top: 3),
        child: pw.Text(
          "Seuil d'admission : ${card.passMark.replaceAll('.', ',')} / 20${verdictAnnee == null ? ' — résultat provisoire, la décision se prend sur la moyenne annuelle' : ''}",
          style: base.copyWith(fontSize: 7.5, color: const PdfColor.fromInt(0xFF666666)),
        ),
      ),
    ],
    pw.Padding(padding: const pw.EdgeInsets.only(top: 6), child: pw.Text('Le ${_dateFr()}', style: base.copyWith(fontSize: 8, color: _gris))),
  ]);

  final doc = pw.Document(title: 'Bulletin — ${eleve.fullName} — T${card.term}', author: ecole);
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      theme: pw.ThemeData.withFont(base: latin, bold: latinGras, italic: latinItalique, fontFallback: [arabe]),
      build: (context) => pw.Container(
        padding: const pw.EdgeInsets.all(12),
        decoration: pw.BoxDecoration(border: pw.Border.all(color: noir, width: 1.5)),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
          // ═══ EN-TÊTE TRICOLONNE ═══
          pw.Container(
            padding: const pw.EdgeInsets.only(bottom: 6),
            decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: PdfColor.fromInt(0xFF333333), width: 2.5))),
            child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Expanded(
                child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                  pw.Text('République Islamique de Mauritanie', style: gras.copyWith(fontSize: 9)),
                  pw.Text('Honneur – Fraternité – Justice', style: pw.TextStyle(font: latinItalique, fontSize: 8, color: const PdfColor.fromInt(0xFF444444))),
                  pw.Text("Ministère de l'Éducation Nationale", style: pw.TextStyle(font: latinGras, fontSize: 8, color: const PdfColor.fromInt(0xFF333333))),
                ]),
              ),
              pw.Padding(
                padding: const pw.EdgeInsets.symmetric(horizontal: 8),
                child: pw.Column(children: [
                  // Le cachet de l'école : un rond vert, comme l'icône du site.
                  pw.Container(
                    width: 22,
                    height: 22,
                    margin: const pw.EdgeInsets.only(bottom: 2),
                    decoration: pw.BoxDecoration(shape: pw.BoxShape.circle, border: pw.Border.all(color: _vertEcole, width: 1.5)),
                  ),
                  texte(ecole, taille: 10, grasse: true, couleur: _vertEcole, align: pw.TextAlign.center),
                ]),
              ),
              pw.Expanded(
                child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
                  ar('الجمهورية الإسلامية الموريتانية', taille: 9, grasse: true),
                  ar('شرف – إخاء – عدل', taille: 8, couleur: const PdfColor.fromInt(0xFF444444)),
                  ar('وزارة التربية الوطنية', taille: 8, grasse: true, couleur: const PdfColor.fromInt(0xFF333333)),
                ]),
              ),
            ]),
          ),
          pw.SizedBox(height: 8),
          // ═══ BANDEAU DE TITRE ═══
          pw.Container(
            color: _bleuNuit,
            padding: const pw.EdgeInsets.symmetric(vertical: 6, horizontal: 10),
            child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.center, children: [
              ar('بطاقة الأعداد', taille: 11, grasse: true, couleur: PdfColors.white),
              pw.Text('   —   ', style: base.copyWith(color: PdfColors.white)),
              pw.Text('BULLETIN DE NOTES', style: pw.TextStyle(font: latinGras, fontSize: 11, color: PdfColors.white, letterSpacing: 2)),
              pw.Text('   —   ', style: base.copyWith(color: PdfColors.white)),
              ar('بطاقة الأعداد', taille: 11, grasse: true, couleur: PdfColors.white),
            ]),
          ),
          pw.SizedBox(height: 8),
          // ═══ SIX LIGNES BILINGUES ═══
          pw.Container(
            padding: const pw.EdgeInsets.symmetric(vertical: 5, horizontal: 8),
            decoration: pw.BoxDecoration(color: const PdfColor.fromInt(0xFFFAFAFA), border: pw.Border.all(color: const PdfColor.fromInt(0xFFCCCCCC), width: .5)),
            child: infos([
              ('السنة الدراسية', 'Année Scolaire', _anneeScolaire(card.academicYear), false),
              ('الاسم', 'Nom et Prénom', eleve.fullName, true),
              ('رقم التسجيل', 'Matricule', '${s['matricule'] ?? ''}', false),
              ('القسم', 'Classe', '${s['level_name'] ?? eleve.levelName ?? ''} — ${s['group_name'] ?? eleve.groupName ?? ''}', true),
              ('الفصل', 'Trimestre', '${card.term}${_ordinal(card.term)}', false),
              ('ولي الأمر', 'Parent / Tuteur', '${s['guardian_name'] ?? ''}', false),
            ]),
          ),
          pw.SizedBox(height: 8),
          if (card.withheld)
            pw.Container(
              margin: const pw.EdgeInsets.only(bottom: 8),
              padding: const pw.EdgeInsets.all(8),
              decoration: pw.BoxDecoration(color: const PdfColor.fromInt(0xFFFDF3E3), border: pw.Border.all(color: const PdfColor.fromInt(0xFFF0DCB8), width: .5)),
              child: texte(card.reason ?? "Les notes d'examen s'affichent une fois la situation financière régularisée.", taille: 8.5, grasse: true, couleur: const PdfColor.fromInt(0xFF8A5300)),
            ),
          // ═══ LE TABLEAU ═══
          tableau,
          pw.SizedBox(height: 8),
          // ═══ PIED TRICOLONNE ═══
          pw.Container(
            padding: const pw.EdgeInsets.only(top: 6),
            decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(color: PdfColor.fromInt(0xFF333333), width: 1.5))),
            child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Expanded(flex: 5, child: resultats),
              pw.SizedBox(width: 8),
              pw.Expanded(
                flex: 3,
                child: pw.Column(children: [
                  cadreTitre(pw.Column(children: [
                    ar('توقيع مدير المدرسة وختمها', taille: 8, grasse: true, couleur: griseTitre, align: pw.TextAlign.center),
                    pw.Text('Signature et cachet du Directeur', textAlign: pw.TextAlign.center, style: stTitre()),
                  ])),
                  pw.Container(height: 48, margin: const pw.EdgeInsets.symmetric(horizontal: 5), decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: _gris, width: .5)))),
                ]),
              ),
              pw.SizedBox(width: 8),
              pw.Expanded(
                flex: 3,
                child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
                  cadreTitre(mixte([
                    ar('ملاحظات المدير', taille: 8, grasse: true, couleur: griseTitre),
                    pw.Text(' — Observations du Directeur', style: stTitre()),
                  ], align: pw.MainAxisAlignment.end)),
                  pw.Container(height: 36, decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(color: PdfColor.fromInt(0xFFCCCCCC), width: .5)))),
                ]),
              ),
            ]),
          ),
          pw.SizedBox(height: 8),
          // ═══ MISE EN GARDE ═══
          pw.Container(
            color: _bleuNuit,
            padding: const pw.EdgeInsets.symmetric(vertical: 4, horizontal: 8),
            child: mixte([
              ar('هذه الوثيقة لا تصلح بدون توقيع', taille: 7.5, grasse: true, couleur: PdfColors.white),
              pw.Text("  —  CE DOCUMENT N'EST PAS VALABLE SANS SIGNATURE", style: pw.TextStyle(font: latinGras, fontSize: 7.5, color: PdfColors.white)),
            ], align: pw.MainAxisAlignment.center),
          ),
        ]),
      ),
    ),
  );
  return doc.save();
}

const _bleuNuit = PdfColor.fromInt(0xFF1A3A5C);
const _bleuClair = PdfColor.fromInt(0xFFE8F0FE);
const _vertEcole = PdfColor.fromInt(0xFF1A6B3C);
const _admis = PdfColor.fromInt(0xFF059669);
const _ajourne = PdfColor.fromInt(0xFFDC2626);
const _encre = PdfColor.fromInt(0xFF111111);
const _gris = PdfColor.fromInt(0xFF555555);
const _filet = PdfColor.fromInt(0xFFAAAAAA);

final _plageArabe = RegExp('[؀-ۿݐ-ݿ]');
bool _contientArabe(String s) => _plageArabe.hasMatch(s);

String _ordinal(int t) => t == 1 ? 'er' : 'e';

String _coef(Object? v, String defaut) {
  final n = double.tryParse('${v ?? defaut}') ?? double.parse(defaut);
  return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
}

String _anneeScolaire(String label) {
  final m = RegExp(r'^(\d{4})-(\d{4})$').firstMatch(label);
  return m == null ? label : '${m.group(1)} – ${m.group(2)}';
}

String _dateFr() {
  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const mois = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  final d = DateTime.now();
  return '${jours[d.weekday % 7]} ${d.day.toString().padLeft(2, '0')} ${mois[d.month]} ${d.year}';
}
