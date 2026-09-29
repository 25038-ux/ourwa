import 'package:flutter/material.dart';
import '../api.dart';
import '../i18n.dart';
import '../theme.dart';
import '_shared.dart';

/// ABSENCES — `pages/parent/absences.php`.
///
/// ⚠ FAMILY-WIDE, NOT PER CHILD. Its query is `WHERE e.parent_id = :p` and its
/// table opens with an "Élève" column. Ours put a child picker on top, which is
/// the wrong shape for the question: a parent with four children opening this
/// wants to know whether ANYONE was absent. The answer is usually "no one", and
/// a picker makes that four taps instead of none.
///
/// Its five columns — Élève · Date · Matière · Statut · Justifiée — with the
/// status as a coloured pill: danger for "Absent", warning for "Retard".
/// ⚠ ET IL SERT DEUX ÉCRANS, DONT UN BORNÉ À UN SEUL ENFANT. Dans la barre du
/// bas c'est le feed familial de `absences.php` ; à l'intérieur de la fiche
/// d'un enfant, c'est l'onglet « 📅 Absences » de `enfant.php`, qui lit
/// `WHERE a.etudiant_id = :e`. Sans `childId`, ouvrir la fiche de Fatima
/// affichait les absences d'Ahmed à côté des siennes.
class AbsencesTab extends StatefulWidget {
  const AbsencesTab({super.key, required this.api, required this.lang, this.childId});

  final ApiClient api;
  final String lang;

  /// Renseigné dans la fiche d'un enfant ; nul dans le feed familial.
  final String? childId;

  @override
  State<AbsencesTab> createState() => _AbsencesTabState();
}

class _AbsencesTabState extends State<AbsencesTab> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.get(_chemin);
  }

  String get _chemin => widget.childId == null
      ? '/parent/attendance'
      : '/parent/children/${widget.childId}/attendance';

  Future<void> _reload() async {
    setState(() => _future = widget.api.get(_chemin));
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
          final rows = (snap.data?['entries'] as List<dynamic>? ?? const [])
              .cast<Map<String, dynamic>>();

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              FeedHeader(
                emoji: '📅',
                title: t('absences', lang),
                subtitle: t('historique_absences', lang),
              ),
              if (rows.isEmpty)
                EmptyFeed(label: t('aucune_absence', lang))
              else
                for (final r in rows) _AbsenceRow(row: r, lang: lang, plusieursEcoles: widget.api.ecoles.length > 1),
            ],
          );
        },
      ),
    );
  }
}

class _AbsenceRow extends StatelessWidget {
  const _AbsenceRow({required this.row, required this.lang, this.plusieursEcoles = false});
  /// La famille a des enfants dans plusieurs branches : l'école suit le nom.
  final bool plusieursEcoles;

  final Map<String, dynamic> row;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final late = '${row['status']}' == 'late';
    final excused = row['excused'] as bool? ?? false;

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
                    nomAvecEcole(row, '${row['student_name']}',
                        plusieursEcoles: plusieursEcoles, arabe: lang == 'ar'),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: Ocean.ink900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      jourMoisAn('${row['on_date']}'),
                      if (row['subject'] != null) '${row['subject']}',
                    ].join(' · '),
                    style: const TextStyle(fontSize: 13.5, color: Ocean.ink500),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // ⚠ Its two pills: danger for Absent, warning for Retard. A
                // lateness and an absence are not the same news to a parent.
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
                  decoration: BoxDecoration(
                    color: late ? const Color(0x26F59E0B) : const Color(0x26EF4444),
                    borderRadius: BorderRadius.circular(Ocean.rFull),
                  ),
                  child: Text(
                    late ? t('retard', lang) : t('absent', lang),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      color: late ? const Color(0xFFB45309) : const Color(0xFFB91C1C),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                // Its "Justifiée" column. Said in words as well as a mark: a
                // parent reading only a colour cannot tell an excused absence
                // from one the school is still asking about.
                Text(
                  excused
                      ? '✓ ${t('justifiee', lang)}'
                      : '— ${t('non_justifiee', lang)}',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: excused ? Ocean.success : Ocean.ink500,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
