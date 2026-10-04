import 'package:flutter/material.dart';
import '../api.dart';
import '_shared.dart';
import '../i18n.dart';
import '../theme.dart';

/// RÉSULTATS — `pages/parent/resultats.php`.
///
/// ⚠ IT IS A CHRONOLOGICAL FEED ACROSS ALL THE CHILDREN, not a bulletin and not
/// a term picker. "Toutes les notes saisies par les enseignants, du plus récent
/// au plus ancien." I had built three trimester tiles leading to a report card,
/// which answers a different question — a parent opening this wants to know what
/// came in since they last looked, and with four children they want it in one
/// list, not four.
///
/// The bulletin still exists and is still the printed document; it is reached
/// from a child's card, which is where its own `enfant.php` puts it.
///
/// ⚠ THE PILL THRESHOLDS ARE ITS OWN AND I WOULD HAVE GUESSED THEM WRONG:
/// `$val >= 14 ? success : ($val >= 10 ? info : danger)`. Fourteen, not fifteen.
class ResultatsTab extends StatefulWidget {
  const ResultatsTab({super.key, required this.api, required this.lang});

  final ApiClient api;
  final String lang;

  @override
  State<ResultatsTab> createState() => _ResultatsTabState();
}

class _ResultatsTabState extends State<ResultatsTab> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.get('/parent/grades');
  }

  Future<void> _reload() async {
    setState(() => _future = widget.api.get('/parent/grades'));
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.lang;

    return RefreshIndicator(
      onRefresh: _reload,
      child: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Squelette(lignes: 5, hauteur: 72);
          }
          if (snap.hasError) {
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              children: [
                EtatVide(
                  icone: Icons.cloud_off_rounded,
                  titre: lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
                  texte: t('erreur_reseau', lang),
                  action: FilledButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh), label: Text(lang == 'ar' ? 'إعادة المحاولة' : 'Réessayer')),
                ),
              ],
            );
          }
          final rows = (snap.data?['grades'] as List<dynamic>? ?? const [])
              .cast<Map<String, dynamic>>();
          final withheld = snap.data?['examsWithheld'] as bool? ?? false;
          // Quelles écoles retiennent (une famille de plusieurs écoles lisait
          // l'avis pour toutes alors qu'une seule avait une dette).
          final ecolesRetenues = ((snap.data?['withheldSchools'] as List<dynamic>?) ?? const [])
              .whereType<Map<String, dynamic>>()
              .map((e) => Ecole.fromJson(e).libelle(lang == 'ar'))
              .toList();

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              Text(
                '📊 ${t('resultats', lang)}',
                style: const TextStyle(
                  fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'],
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: Ocean.ink900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                t('resultats_sous_titre', lang),
                style: const TextStyle(fontSize: 14.5, height: 1.4, color: Ocean.ink500),
              ),
              const SizedBox(height: 16),

              // ⚠ Its notice, verbatim, when exams are being withheld. It says
              // what to do — "Rapprochez-vous du secrétariat" — and never names
              // a sum. See `parent_avis_examens_bloques()`.
              if (withheld) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFBEB),
                    border: Border.all(color: const Color(0xFFFDE68A)),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t('examens_bloques_titre', lang),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF92400E),
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        t('examens_bloques_texte', lang),
                        style: const TextStyle(
                          height: 1.45,
                          color: Color(0xFF92400E),
                          fontSize: 14,
                        ),
                      ),
                      if (widget.api.ecoles.length > 1 && ecolesRetenues.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          t('examens_bloques_ecoles', lang).replaceAll('{ecoles}', ecolesRetenues.join(', ')),
                          style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF92400E), fontSize: 13.5),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              if (rows.isEmpty)
                EtatVide(icone: Icons.bar_chart_rounded, titre: t('aucune_note', lang))
              else
                for (final r in rows) _GradeRow(row: r, lang: lang, plusieursEcoles: widget.api.ecoles.length > 1),
            ],
          );
        },
      ),
    );
  }
}

/// One mark. Its six columns, stacked for a phone: who, what, how much, and
/// when — the pill carrying the mark and its colour.
class _GradeRow extends StatelessWidget {
  const _GradeRow({required this.row, required this.lang, this.plusieursEcoles = false});
  /// La famille a des enfants dans plusieurs branches : l'école suit le nom.
  final bool plusieursEcoles;

  final Map<String, dynamic> row;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final score = double.tryParse('${row['score']}') ?? 0;
    final max = double.tryParse('${row['maxScore'] ?? '20'}') ?? 20;
    // The pill's threshold is judged on the twenty-point scale, so a subject
    // marked out of 50 is compared like any other.
    final onTwenty = max > 0 ? score * 20 / max : score;

    // ⚠ Its rule exactly: >= 14 success, >= 10 info, else danger.
    final (bg, fg) = onTwenty >= 14
        ? (const Color(0x2610B981), const Color(0xFF047857))
        : onTwenty >= 10
            ? (const Color(0x261F8A65), const Color(0xFF0F5C43))
            : (const Color(0x26EF4444), const Color(0xFFB91C1C));

    final kind = '${row['kind']}' == 'exam' ? t('examen', lang) : t('devoir', lang);
    final at = DateTime.tryParse('${row['recordedAt']}');
    final date = at == null
        ? ''
        : '${at.day.toString().padLeft(2, '0')}/${at.month.toString().padLeft(2, '0')}/${at.year}';

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.72),
          borderRadius: BorderRadius.circular(Ocean.rMd),
          border: Border.all(color: Ocean.glassBorder),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    nomAvecEcole(row, '${row['studentName']}',
                        plusieursEcoles: plusieursEcoles, arabe: lang == 'ar'),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: Ocean.ink900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${row['subject']}',
                    style: const TextStyle(fontSize: 14, color: Ocean.ink700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    // Its last three columns, run together on a narrow screen.
                    '$kind · ${t('trimestre', lang)} ${row['term']} · $date',
                    style: const TextStyle(fontSize: 12.5, color: Ocean.ink500),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(Ocean.rFull),
              ),
              child: Text(
                // Its own format: the mark, then the scale it was marked on.
                '${_trim(score)}/${_trim(max)}',
                style: TextStyle(fontWeight: FontWeight.w700, color: fg, fontSize: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "8,5" not "8.50"; "20" not "20.00" — the same trim its averages use.
String _trim(double v) {
  var s = v.toStringAsFixed(2).replaceAll('.', ',');
  while (s.endsWith('0')) {
    s = s.substring(0, s.length - 1);
  }
  if (s.endsWith(',')) s = s.substring(0, s.length - 1);
  return s;
}
