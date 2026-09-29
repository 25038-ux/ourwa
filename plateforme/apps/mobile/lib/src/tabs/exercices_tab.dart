import 'package:flutter/material.dart';
import '../api.dart';
import '../i18n.dart';
import '../theme.dart';
import '_shared.dart';

/// Exercices — `pages/parent/exercices.php`.
///
/// ⚠ THE DUE DATE IS WHY A PARENT OPENS THIS. It is shown as its own line and
/// marked when it has passed, because "à rendre lundi" read on Tuesday is worse
/// than useless.
class ExercicesTab extends StatelessWidget {
  const ExercicesTab({super.key, required this.api, required this.lang});

  final ApiClient api;
  final String lang;

  @override
  Widget build(BuildContext context) {
    return ChildTabScaffold(
      api: api,
      lang: lang,
      builder: (context, child, lang) => ChargeurJson(
        api: api,
        chemin: '/parent/homework',
        builder: (context, snapshot, recharger) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Squelette(lignes: 5, hauteur: 72);
          }
          if (snapshot.hasError) {
            return EtatVide(
              icone: Icons.cloud_off_rounded,
              titre: lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
              texte: t('erreur_reseau', lang),
              action: FilledButton.icon(onPressed: recharger, icon: const Icon(Icons.refresh), label: Text(lang == 'ar' ? 'إعادة المحاولة' : 'Réessayer')),
            );
          }
          final rows = snapshot.data?['homework'] as List<dynamic>? ?? const [];
          if (rows.isEmpty) {
            return TabEmpty(
              icon: Icons.menu_book_outlined,
              message: t('aucun_exercice', lang),
            );
          }

          final today = DateTime.now();

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final h = rows[i] as Map<String, dynamic>;
              final dueRaw = h['due_on'] as String?;
              final due = dueRaw == null ? null : DateTime.tryParse(dueRaw);
              final overdue = due != null && due.isBefore(DateTime(today.year, today.month, today.day));

              return GlassCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            h['title'] as String? ?? '',
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        if (h['subject'] != null)
                          Container(
                            padding:
                                const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            decoration: BoxDecoration(
                              color: Ocean.c50,
                              borderRadius: BorderRadius.circular(Ocean.rFull),
                              border: Border.all(color: Ocean.c200),
                            ),
                            child: Text(
                              h['subject'] as String,
                              style: const TextStyle(fontSize: 11, color: Ocean.c700),
                            ),
                          ),
                      ],
                    ),
                    if ((h['body'] as String?)?.isNotEmpty ?? false) ...[
                      const SizedBox(height: 8),
                      Text(h['body'] as String, style: const TextStyle(height: 1.45)),
                    ],
                    // ⚠ SES PIÈCES JOINTES, ENTRE L'ÉNONCÉ ET LA DATE LIMITE —
                    // c'est l'ordre de `exercices.php`. Elles n'arrivaient pas
                    // jusqu'ici : le professeur pouvait joindre le sujet et la
                    // famille ne le voyait jamais.
                    GrilleFichiers(
                      api: api,
                      fichiers: ((h['attachments'] as List<dynamic>?) ?? const [])
                          .cast<Map<String, dynamic>>(),
                    ),
                    if (due != null) ...[
                      const SizedBox(height: 14),
                      /**
                       * ⚠ A PILL, AND THE WORDING CHANGES WHEN IT HAS PASSED.
                       *
                       * Not yet due:  amber, "À rendre avant le 15/03/2026"
                       * Passed:       red,   "Date dépassée — 15/03/2026"
                       *
                       * Ours said "À rendre" either way, which read as an
                       * instruction about a deadline that had already gone. Its
                       * two sentences are two different pieces of news.
                       */
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                          decoration: BoxDecoration(
                            color: overdue
                                ? const Color(0x1FEF4444)
                                : const Color(0x1FF59E0B),
                            borderRadius: BorderRadius.circular(Ocean.rFull),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.schedule,
                                size: 14,
                                color: overdue
                                    ? const Color(0xFFB91C1C)
                                    : const Color(0xFFB45309),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                overdue
                                    ? '${t('date_depassee', lang)} ${_jourMoisAn(dueRaw!)}'
                                    : '${t('a_rendre_avant', lang)} ${_jourMoisAn(dueRaw!)}',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: overdue
                                      ? const Color(0xFFB91C1C)
                                      : const Color(0xFFB45309),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

/// Its `date('d/m/Y')`. An ISO date on a parent's phone is a date they have to
/// decode; 15/03/2026 is one they can read.
String _jourMoisAn(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  String p(int n) => n.toString().padLeft(2, '0');
  return '${p(d.day)}/${p(d.month)}/${d.year}';
}
