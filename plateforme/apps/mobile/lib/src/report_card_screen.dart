import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import 'api.dart';
import 'bulletin_pdf.dart';
import 'i18n.dart';
import 'ouvrir_fichier.dart';
import 'telechargements.dart';
import 'theme.dart';
import 'marque.dart';

/// LE BULLETIN DE L'ENFANT — LE DOCUMENT OFFICIEL, TEL QUE LE SITE LE REND.
///
/// Décision du propriétaire (2026-09-20) : pas de vue web ; le bulletin est
/// DESSINÉ ici, en widgets, avec la mise en page de `bulletin_vue.php` telle
/// que le site l'affiche (« Notes & Bulletins ») : en-tête tricolonne
/// bilingue sous un double filet, bandeau de titre bleu nuit, six lignes
/// bilingues, le tableau avec sa ligne d'en-tête arabe AU-DESSUS de la
/// française, les coefficients imprimés dans les en-têtes, le pied
/// (résultats, signature, observations) et la mise en garde. Mêmes couleurs
/// (`bulletin-css.ts`) : #1a3a5c, #e8f0fe, #1a6b3c, #059669, #DC2626.
///
/// Rien n'est calculé ici : les chiffres arrivent tout faits du serveur, un
/// `-1` n'y entre jamais (`absent` est un drapeau), et ce que la famille ne
/// doit pas voir (examens retenus pour dette) est déjà retiré, avec la raison.
///
/// « Bulletin téléchargeable » : le PDF est COMPOSÉ SUR LE TÉLÉPHONE
/// (`bulletin_pdf.dart`) à partir des mêmes chiffres que l'écran, déposé dans
/// Téléchargements et ouvert. La conversion du HTML par la vue web du
/// téléphone (`Printing.convertHtml`) échouait sur certains appareils et ne
/// disait rien d'autre qu'« erreur réseau » — « the bulletins is not
/// downloadable » (23/09/2026).
class ReportCardScreen extends StatefulWidget {
  const ReportCardScreen({
    super.key,
    required this.api,
    required this.child,
    required this.isArabic,
    this.embedded = false,
  });

  final ApiClient api;
  final Child child;
  final bool isArabic;

  /// Inside the child screen's tab bar it has no chrome of its own — the
  /// screen already carries the name and the way back.
  final bool embedded;

  @override
  State<ReportCardScreen> createState() => _ReportCardScreenState();
}

class _ReportCardScreenState extends State<ReportCardScreen> {
  int _term = 1;
  late Future<ReportCard> _card;
  bool _telechargement = false;

  String get _lang => widget.isArabic ? 'ar' : 'fr';

  @override
  void initState() {
    super.initState();
    _card = _load();
  }

  Future<ReportCard> _load() async {
    final json = await widget.api.get('/parent/children/${widget.child.id}/report-card?term=$_term');
    return ReportCard.fromJson(json);
  }

  void _setTerm(int term) {
    setState(() {
      _term = term;
      _card = _load();
    });
  }

  String get _nomFichier {
    final nom = '${widget.child.firstName}-${widget.child.lastName}'.replaceAll(RegExp(r'[^\w\-]+'), '_');
    return 'bulletin-$nom-T$_term.pdf';
  }

  bool get _pdfPossible =>
      !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  /// Le PDF : composé ici depuis la carte déjà chargée (aucun aller-retour
  /// réseau, aucune vue web), déposé dans Téléchargements (Android 10+) ou
  /// ouvert depuis le cache, et sinon proposé au partage (Fichiers, WhatsApp,
  /// courriel…). Sur le web, le navigateur le télécharge.
  Future<void> _telecharger() async {
    setState(() => _telechargement = true);
    String? message;
    try {
      final card = await _card;
      final ecole = widget.child.school?.libelle(widget.isArabic) ??
          widget.api.ecoles.firstOrNull?.libelle(widget.isArabic) ??
          Marque.selon(_lang);
      final pdf = await bulletinPdf(card, ecole, widget.child);
      if (kIsWeb) {
        ouvrirDansNavigateur(pdf, _nomFichier, 'application/pdf');
      } else if (_pdfPossible) {
        final r = await Telechargements.enregistrerEtOuvrir(_nomFichier, pdf, 'application/pdf');
        if (r == 'telechargements') {
          message = t('bulletin_enregistre', _lang);
        } else if (r == 'ouvert') {
          message = t('bulletin_ouvert', _lang);
        } else {
          message = t('bulletin_partage', _lang);
          await Printing.sharePdf(bytes: pdf, filename: _nomFichier);
        }
      } else {
        await Printing.sharePdf(bytes: pdf, filename: _nomFichier);
      }
    } catch (_) {
      // Rien n'est parti sur le réseau ici : le PDF se compose et s'enregistre
      // sur le téléphone. Dire « erreur de communication » enverrait la
      // famille chercher un meilleur réseau pour un défaut du téléphone.
      message = t('bulletin_erreur', _lang);
    } finally {
      if (mounted) {
        setState(() => _telechargement = false);
        if (message != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ar = widget.isArabic;
    if (widget.embedded) return _corps(context, ar);
    return Scaffold(
      appBar: AppBar(title: Text(widget.child.fullName)),
      body: _corps(context, ar),
    );
  }

  Widget _corps(BuildContext context, bool ar) {
    final selecteur = Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
      child: SegmentedButton<int>(
        segments: [
          for (var t = 1; t <= 3; t++) ButtonSegment(value: t, label: Text(ar ? 'الفصل $t' : 'Trim. $t')),
        ],
        selected: {_term},
        onSelectionChanged: (s) => _setTerm(s.first),
      ),
    );
    return FutureBuilder<ReportCard>(
      future: _card,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Column(children: [selecteur, const Expanded(child: Squelette(lignes: 4, hauteur: 110))]);
        }
        if (snapshot.hasError) {
          return ListView(
            children: [
              selecteur,
              EtatVide(
                icone: Icons.cloud_off_rounded,
                titre: ar ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
                texte: t('erreur_reseau', _lang),
                action: FilledButton.icon(onPressed: () => _setTerm(_term), icon: const Icon(Icons.refresh), label: Text(ar ? 'إعادة المحاولة' : 'Réessayer')),
              ),
            ],
          );
        }
        final card = snapshot.data!;
        final ecole = widget.child.school?.libelle(ar) ?? widget.api.ecoles.firstOrNull?.libelle(ar) ?? Marque.selon(ar ? 'ar' : 'fr');
        return ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            selecteur,
            if (card.withheld) _Withheld(reason: card.reason, isArabic: ar),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              // Le document est calé pour une feuille : sur un téléphone il
              // défile de côté plutôt que de casser ses colonnes.
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SizedBox(
                  // Au moins 560 dp (les colonnes du tableau tiennent) ; sur
                  // un grand écran, la largeur disponible, jusqu'à 960 comme le site.
                  width: (MediaQuery.sizeOf(context).width - 24).clamp(560.0, 960.0),
                  child: BulletinOfficiel(card: card, ecole: ecole, eleve: widget.child),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: FilledButton.icon(
                onPressed: _telechargement ? null : _telecharger,
                icon: _telechargement
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.download_rounded),
                label: Text(t('telecharger_bulletin', _lang)),
              ),
            ),
          ],
        );
      },
    );
  }
}

// ── LE DOCUMENT ─────────────────────────────────────────────────────────────

const _bleuNuit = Color(0xFF1A3A5C);
const _bleuClair = Color(0xFFE8F0FE);
const _vertEcole = Color(0xFF1A6B3C);
const _admis = Color(0xFF059669);
const _ajourne = Color(0xFFDC2626);
const _encre = Color(0xFF111111);
const _gris = Color(0xFF555555);
const _filet = Color(0xFFAAAAAA);
const _serif = TextStyle(fontFamily: 'serif', color: _encre, fontSize: 11.5, height: 1.25);

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

Color? _couleurSeuil(String? valeur, double seuil) {
  final v = valeur == null ? null : double.tryParse(valeur);
  if (v == null) return null;
  return v >= seuil ? _admis : _ajourne;
}

/// Le bulletin officiel bilingue — port de `BulletinOfficiel` (site) en widgets.
class BulletinOfficiel extends StatelessWidget {
  const BulletinOfficiel({super.key, required this.card, required this.ecole, required this.eleve});
  final ReportCard card;
  final String ecole;
  final Child eleve;

  @override
  Widget build(BuildContext context) {
    final fond = card.isFondamental;
    final s = card.student ?? const <String, dynamic>{};
    final seuil = double.tryParse(card.passMark) ?? 10;
    final verdict = card.verdict;
    final verdictAnnee = card.annualVerdict;
    final verdictAffiche = !card.withheld && verdict != null;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFF222222), width: 2)),
      child: DefaultTextStyle(
        style: _serif,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ═══ EN-TÊTE TRICOLONNE ═══
            Container(
              padding: const EdgeInsets.only(bottom: 8),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFF333333), width: 3, style: BorderStyle.solid))),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('République Islamique de Mauritanie', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 10.5)),
                        Text('Honneur – Fraternité – Justice', style: TextStyle(fontStyle: FontStyle.italic, fontSize: 9.5, color: Color(0xFF444444))),
                        Text("Ministère de l'Éducation Nationale", style: TextStyle(fontWeight: FontWeight.w600, fontSize: 9.5, color: Color(0xFF333333))),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Column(
                      children: [
                        const Icon(Icons.school_outlined, size: 40, color: _vertEcole),
                        Text(ecole, textAlign: TextAlign.center, style: const TextStyle(fontFamily: 'Fraunces', fontWeight: FontWeight.w800, fontSize: 12, color: _vertEcole)),
                      ],
                    ),
                  ),
                  const Expanded(
                    child: Directionality(
                      textDirection: TextDirection.rtl,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('الجمهورية الإسلامية الموريتانية', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 10.5)),
                          Text('شرف – إخاء – عدل', style: TextStyle(fontSize: 9.5, color: Color(0xFF444444))),
                          Text('وزارة التربية الوطنية', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 9.5, color: Color(0xFF333333))),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            // ═══ BANDEAU DE TITRE ═══
            Container(
              color: _bleuNuit,
              padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 12),
              child: const Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 12,
                children: [
                  Text('بطاقة الأعداد', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                  Text('—', style: TextStyle(color: Colors.white54)),
                  Text('BULLETIN DE NOTES', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 2)),
                  Text('—', style: TextStyle(color: Colors.white54)),
                  Text('بطاقة الأعداد', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(height: 10),
            // ═══ SIX LIGNES BILINGUES ═══
            Container(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 10),
              decoration: BoxDecoration(color: const Color(0xFFFAFAFA), border: Border.all(color: const Color(0xFFCCCCCC))),
              child: _GrilleInfos(lignes: [
                ('السنة الدراسية', 'Année Scolaire', _anneeScolaire(card.academicYear), false),
                ('الاسم', 'Nom et Prénom', eleve.fullName, true),
                ('رقم التسجيل', 'Matricule', '${s['matricule'] ?? ''}', false),
                ('القسم', 'Classe', '${s['level_name'] ?? eleve.levelName ?? ''} — ${s['group_name'] ?? eleve.groupName ?? ''}', true),
                ('الفصل', 'Trimestre', '${card.term}${_ordinal(card.term)}', false),
                ('ولي الأمر', 'Parent / Tuteur', '${s['guardian_name'] ?? ''}', false),
              ]),
            ),
            const SizedBox(height: 10),
            // ═══ LE TABLEAU ═══
            _Tableau(card: card, fond: fond, verdictAffiche: verdictAffiche, seuil: seuil),
            const SizedBox(height: 10),
            // ═══ PIED TRICOLONNE ═══
            Container(
              padding: const EdgeInsets.only(top: 8),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0xFF333333), width: 2))),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 5,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _TitrePied('Résultats / النتائج'),
                        if (fond)
                          for (final (i, rf) in card.termRecapFondamental.indexed)
                            _LigneResultat(
                              'Total — ${i + 1}${_ordinal(i + 1)} trimestre :',
                              rf == null ? '—' : '${rf['points']} / ${_coef(rf['outOf'], '0')}',
                              rf == null ? null : _couleurSeuil(_equiv20(rf), seuil),
                            )
                        else
                          for (final (i, mg) in card.termRecap.indexed)
                            _LigneResultat('Moyenne Générale — ${i + 1}${_ordinal(i + 1)} trimestre :', mg == null ? '—' : '$mg / 20', _couleurSeuil(mg, seuil)),
                        if (card.annualAverage != null || card.annualFondamental != null)
                          Container(
                            margin: const EdgeInsets.only(top: 4),
                            padding: const EdgeInsets.only(top: 4),
                            decoration: const BoxDecoration(border: Border(top: BorderSide(color: _vertEcole, width: 1.5))),
                            child: _LigneResultat(
                              "Moyenne Générale de l'Année : المعدل السنوي",
                              card.annualFondamental != null ? '${card.annualFondamental!['points']} / ${_coef(card.annualFondamental!['outOf'], '0')}' : '${card.annualAverage} / 20',
                              verdictAnnee == null ? null : (verdictAnnee.status == 'admis' ? _admis : verdictAnnee.status == 'ajourne' ? _ajourne : null),
                              gras: true,
                            ),
                          ),
                        if (verdictAffiche) ...[
                          const SizedBox(height: 4),
                          _LigneResultat('Appréciation (${card.term}${_ordinal(card.term)} trim.) :', card.band ?? '', verdict.status == 'admis' ? _admis : verdict.status == 'ajourne' ? _ajourne : null),
                          const SizedBox(height: 4),
                          Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 6,
                            children: [
                              Text(verdictAnnee != null ? 'Décision annuelle : القرار السنوي' : 'Résultat du trimestre : نتيجة الفصل', style: const TextStyle(color: _gris, fontSize: 10.5)),
                              _BadgeAdmission(verdict: verdictAnnee ?? verdict),
                            ],
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              "Seuil d'admission : ${card.passMark.replaceAll('.', ',')} / 20${verdictAnnee == null ? ' — résultat provisoire, la décision se prend sur la moyenne annuelle' : ''}",
                              style: const TextStyle(fontSize: 9, color: Color(0xFF666666)),
                            ),
                          ),
                        ],
                        Padding(padding: const EdgeInsets.only(top: 8), child: Text('Le ${_dateFr()}', style: const TextStyle(fontSize: 9.5, color: _gris))),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 3,
                    child: Column(
                      children: [
                        const _TitrePied('توقيع مدير المدرسة وختمها\nSignature et cachet du Directeur', centre: true),
                        Container(height: 55, margin: const EdgeInsets.symmetric(horizontal: 6), decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: _gris)))),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 3,
                    child: Directionality(
                      textDirection: TextDirection.rtl,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const _TitrePied('ملاحظات المدير — Observations du Directeur'),
                          Container(height: 40, decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFCCCCCC))))),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            // ═══ MISE EN GARDE ═══
            Container(
              color: _bleuNuit,
              padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 10),
              child: const Text(
                "⚠ هذه الوثيقة لا تصلح بدون توقيع — CE DOCUMENT N'EST PAS VALABLE SANS SIGNATURE ⚠",
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 9, letterSpacing: .3),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Un niveau fondamental se compare en équivalent /20.
  static String? _equiv20(Map<String, dynamic> rf) {
    final sur = double.tryParse('${rf['outOf']}') ?? 0;
    final pts = double.tryParse('${rf['points']}') ?? 0;
    return sur > 0 ? (pts * 20 / sur).toStringAsFixed(2) : null;
  }
}

class _GrilleInfos extends StatelessWidget {
  const _GrilleInfos({required this.lignes});
  final List<(String, String, String, bool)> lignes;

  @override
  Widget build(BuildContext context) {
    Widget ligne((String, String, String, bool) l) => Container(
          padding: const EdgeInsets.symmetric(vertical: 2),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFE0E0E0)))),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              SizedBox(width: 78, child: Text(l.$1, textDirection: TextDirection.rtl, style: const TextStyle(color: _gris, fontSize: 10.5))),
              const Text(' | ', style: TextStyle(color: Color(0xFFBBBBBB))),
              SizedBox(width: 92, child: Text(l.$2, style: const TextStyle(color: _gris, fontSize: 10.5))),
              Expanded(child: Text(l.$3, style: TextStyle(fontWeight: l.$4 ? FontWeight.w800 : FontWeight.w600, fontSize: 10.5))),
            ],
          ),
        );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Column(children: [for (var i = 0; i < lignes.length; i += 2) ligne(lignes[i])])),
        const SizedBox(width: 8),
        Expanded(child: Column(children: [for (var i = 1; i < lignes.length; i += 2) ligne(lignes[i])])),
      ],
    );
  }
}

class _Tableau extends StatelessWidget {
  const _Tableau({required this.card, required this.fond, required this.verdictAffiche, required this.seuil});
  final ReportCard card;
  final bool fond;
  final bool verdictAffiche;
  final double seuil;

  @override
  Widget build(BuildContext context) {
    final cw = _coef(card.formula?['courseworkWeight'], '2');
    final ex = _coef(card.formula?['examWeight'], '3');
    final dv = _coef(card.formula?['divisor'], '5');
    final bord = Border.all(color: _filet, width: .6);

    Widget th(String texte, {Color fond = _bleuNuit, Color couleur = Colors.white, bool majuscules = false, String? petit, TextDirection? dir}) => Container(
          decoration: BoxDecoration(color: fond, border: Border.all(color: const Color(0xFF888888), width: .6)),
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 3),
          alignment: Alignment.center,
          child: Column(
            children: [
              Text(majuscules ? texte.toUpperCase() : texte, textAlign: TextAlign.center, textDirection: dir, style: TextStyle(color: couleur, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: majuscules ? .3 : 0)),
              if (petit != null) Text(petit, style: TextStyle(color: couleur, fontSize: 8)),
            ],
          ),
        );
    Widget td(String texte, {bool gauche = false, Color? couleur, FontWeight? poids, double taille = 10.5, Color? fondCase, String? sous}) => Container(
          decoration: BoxDecoration(border: bord, color: fondCase),
          padding: EdgeInsets.fromLTRB(gauche ? 8 : 4, 4, 4, 4),
          alignment: gauche ? Alignment.centerLeft : Alignment.center,
          child: Text(texte, textAlign: gauche ? TextAlign.left : TextAlign.center, style: TextStyle(color: couleur ?? _encre, fontWeight: poids ?? FontWeight.w400, fontSize: taille)),
        );

    final colonnes = fond
        ? const {0: FlexColumnWidth(2.2), 1: FlexColumnWidth(1.6), 2: FlexColumnWidth(1.1), 3: FlexColumnWidth(1), 4: FlexColumnWidth(1.1), 5: FlexColumnWidth(.9)}
        : const {0: FlexColumnWidth(2.2), 1: FlexColumnWidth(1.6), 2: FlexColumnWidth(1.1), 3: FlexColumnWidth(1), 4: FlexColumnWidth(1.1), 5: FlexColumnWidth(.8), 6: FlexColumnWidth(.9)};

    final enteteAr = fond
        ? [th('المواد', dir: TextDirection.rtl), th('الفروض', dir: TextDirection.rtl), th('متوسط الفروض', dir: TextDirection.rtl), th('الامتحان', dir: TextDirection.rtl), th('المعدل ÷2', dir: TextDirection.rtl), th('السلّم', dir: TextDirection.rtl)]
        : [th('المواد', dir: TextDirection.rtl), th('الفروض', dir: TextDirection.rtl), th('متوسط الفروض', petit: '× $cw', dir: TextDirection.rtl), th('الامتحان', petit: '× $ex', dir: TextDirection.rtl), th('المعدل', petit: '÷ $dv', dir: TextDirection.rtl), th('المعامل', dir: TextDirection.rtl), th('المجموع', dir: TextDirection.rtl)];
    final enteteFr = fond
        ? [th('Matière', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Devoirs', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Moy. Devoirs', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Examen', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Moyenne (÷2)', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Notée sur', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true)]
        : [th('Matière', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Devoirs', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Moy. Devoirs', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true, petit: '× $cw'), th('Examen', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true, petit: '× $ex'), th('Moyenne', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true, petit: '÷ $dv'), th('Coeff.', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true), th('Total', fond: _bleuClair, couleur: const Color(0xFF222222), majuscules: true)];

    final lignes = <TableRow>[
      TableRow(children: enteteAr),
      TableRow(children: enteteFr),
    ];
    for (final (i, s) in card.subjects.indexed) {
      final moy = s.mark == null ? null : double.tryParse(s.mark!);
      // Le total vient du serveur (décimal) ; le flottant local n'est qu'un
      // secours pour un serveur d'avant.
      final total = s.total ?? (moy == null ? null : (moy * s.coefficient).toStringAsFixed(2));
      final fondCase = i.isOdd ? const Color(0xFFF8F8F8) : Colors.white;
      final devoirs = s.courseworkMarks.isEmpty ? '—' : s.courseworkMarks.join(' · ');
      lignes.add(TableRow(children: [
        td(s.subject, gauche: true, poids: FontWeight.w600, fondCase: fondCase),
        td(devoirs, taille: 9.5, fondCase: fondCase),
        td(s.coursework ?? '—', fondCase: fondCase),
        td(s.exam ?? '—', fondCase: fondCase),
        if (fond) ...[
          td(s.absent ? 'Absent' : (s.mark ?? '—'), poids: FontWeight.w800, couleur: _vertEcole, fondCase: fondCase),
          td('/ ${_coef(s.maxScore, '20')}', fondCase: fondCase),
        ] else ...[
          td(s.absent ? 'Absent' : (s.mark ?? '—'), poids: FontWeight.w800, taille: 11.5, couleur: moy == null ? null : (moy >= seuil ? _admis : _ajourne), fondCase: fondCase),
          td('${s.coefficient}', fondCase: fondCase),
          td(total ?? '—', poids: FontWeight.w700, fondCase: fondCase),
        ],
      ]));
    }
    // Le pied du tableau : la moyenne générale (ou le total général).
    final piedFond = const Color(0xFFF0F0F0);
    final libelle = fond ? 'المجموع العام | TOTAL GÉNÉRAL' : 'المعدل العام | Moyenne Générale';
    final verdictCouleur = verdictAffiche && card.verdict != null ? (card.verdict!.status == 'admis' ? _admis : card.verdict!.status == 'ajourne' ? _ajourne : null) : null;
    final outOf = double.tryParse(card.outOf ?? '0') ?? 0;
    final pts = double.tryParse(card.points ?? '0') ?? 0;
    final totalCoef = card.totalCoefficients ?? card.subjects.where((s) => s.mark != null).fold<int>(0, (n, s) => n + s.coefficient);
    return Column(
      children: [
        Table(columnWidths: colonnes, defaultVerticalAlignment: TableCellVerticalAlignment.middle, children: lignes),
        Container(
          decoration: BoxDecoration(border: Border.all(color: const Color(0xFF888888), width: .6)),
          child: Row(
            children: [
              Expanded(
                child: Container(
                  color: piedFond,
                  padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                  alignment: Alignment.centerRight,
                  child: Text(libelle, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 10)),
                ),
              ),
              if (!fond)
                Container(
                  width: 52,
                  color: piedFond,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  alignment: Alignment.center,
                  child: Text('$totalCoef', style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
              Container(
                width: 92,
                color: _bleuNuit,
                padding: const EdgeInsets.symmetric(vertical: 6),
                alignment: Alignment.center,
                child: Text(
                  fond ? (outOf > 0 ? '${card.points} / ${_coef(card.outOf, '0')}' : '—') : (card.average ?? 'N/A'),
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13, backgroundColor: verdictCouleur == null || fond ? null : null),
                ),
              ),
            ],
          ),
        ),
        if (!fond && verdictCouleur != null)
          Container(height: 3, color: verdictCouleur, margin: const EdgeInsets.only(top: 1)),
        if (fond && outOf > 0)
          Container(height: 3, color: pts / outOf >= .5 ? _admis : _ajourne, margin: const EdgeInsets.only(top: 1)),
      ],
    );
  }
}

class _TitrePied extends StatelessWidget {
  const _TitrePied(this.texte, {this.centre = false});
  final String texte;
  final bool centre;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.only(bottom: 2),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFCCCCCC)))),
        child: Text(texte, textAlign: centre ? TextAlign.center : null, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 9.5, letterSpacing: .5, color: Color(0xFF333333))),
      );
}

class _LigneResultat extends StatelessWidget {
  const _LigneResultat(this.libelle, this.valeur, this.couleur, {this.gras = false});
  final String libelle;
  final String valeur;
  final Color? couleur;
  final bool gras;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 6,
          children: [
            Text(libelle, style: TextStyle(color: _gris, fontSize: 10.5, fontWeight: gras ? FontWeight.w700 : FontWeight.w400)),
            Text(valeur, style: TextStyle(fontWeight: FontWeight.w800, fontSize: gras ? 12.5 : 11, color: couleur ?? _encre)),
          ],
        ),
      );
}

/// Sa pastille de décision — `badge_admission()`, trois paires de couleurs, deux langues.
class _BadgeAdmission extends StatelessWidget {
  const _BadgeAdmission({required this.verdict});
  final Verdict verdict;
  @override
  Widget build(BuildContext context) {
    final (texte, fond) = switch (verdict.status) {
      'admis' => (const Color(0xFF065F46), const Color(0xFFD1FAE5)),
      'ajourne' => (const Color(0xFF991B1B), const Color(0xFFFEE2E2)),
      _ => (const Color(0xFF4B5563), const Color(0xFFF3F4F6)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(3)),
      child: Text('${verdict.label} ${verdict.labelAr}', style: TextStyle(color: texte, fontWeight: FontWeight.w700, fontSize: 10.5)),
    );
  }
}

/// Son `parent_avis_examens_bloques()` : il dit POURQUOI et COMMENT y
/// remédier, sans jamais nommer une somme — au-dessus du document.
class _Withheld extends StatelessWidget {
  const _Withheld({required this.reason, required this.isArabic});
  final String? reason;
  final bool isArabic;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFFDF3E3), border: Border.all(color: const Color(0xFFF0DCB8)), borderRadius: BorderRadius.circular(10)),
        child: Text(
          reason ?? (isArabic ? 'تظهر نتائج الامتحانات بعد تسوية المستحقات.' : "Les notes d'examen s'affichent une fois la situation financière régularisée."),
          style: const TextStyle(color: Color(0xFF8A5300), fontWeight: FontWeight.w600, height: 1.4),
        ),
      );
}
