import 'package:flutter/material.dart';
import '../api.dart';
import '../i18n.dart';
import '../theme.dart';
import '_shared.dart';

/// Remarques — `pages/parent/remarques.php`.
///
/// ⚠ SEVERITY IS THE POINT. An encouragement and a serious warning arrive on the
/// same screen, and a parent must be able to tell them apart before reading the
/// text. It carries a colour AND its own word, never colour alone.
/// ⚠ IL SERT DEUX ÉCRANS, DONT UN BORNÉ À UN SEUL ENFANT — voir la note de
/// `AbsencesTab`. Dans la fiche d'un enfant, `enfant.php` lit
/// `WHERE etudiant_id = :e LIMIT 30` ; sans `childId` la fiche de Fatima
/// affichait les remarques concernant Ahmed.
class RemarquesTab extends StatelessWidget {
  const RemarquesTab({super.key, required this.api, required this.lang, this.childId});

  final ApiClient api;
  final String lang;

  /// Renseigné dans la fiche d'un enfant ; nul dans le feed familial.
  final String? childId;

  /// Its four severities, its colours, and its own labels.
  ///
  /// The labels are written in `remarques.php` itself rather than in the
  /// translation table, so they are written here too rather than invented as
  /// extracted strings. Note "Félicitations", not "Encouragement" — praise from
  /// the school is congratulation, and the difference is the school's to make.
  ///
  /// Our severities are named `positive` / `warning` / `serious`; theirs are
  /// `positif` / `avertissement` / `grave`. Same four, mapped here.
  static ({Color colour, String fr, String ar}) _severity(String s) => switch (s) {
        'positive' => (colour: Ocean.success, fr: 'Félicitations', ar: 'تهنئة'),
        'warning' => (colour: Ocean.warning, fr: 'Avertissement', ar: 'تحذير'),
        'serious' => (colour: Ocean.danger, fr: 'Grave', ar: 'خطير'),
        _ => (colour: Ocean.c500, fr: 'Information', ar: 'معلومة'),
      };

  @override
  Widget build(BuildContext context) {
    // ⚠ PAS DE SÉLECTEUR D'ENFANT DANS LA FICHE D'UN ENFANT. Le feed familial
    // s'ouvre sur `ChildTabScaffold`, qui en pose un en haut ; à l'intérieur de
    // `enfant.php` l'enfant est déjà choisi, et un second sélecteur laisserait
    // croire qu'on peut en changer sans quitter la fiche.
    if (childId != null) return _liste(context, lang);
    return ChildTabScaffold(
      api: api,
      lang: lang,
      builder: (context, child, lang) => _liste(context, lang),
    );
  }

  Widget _liste(BuildContext context, String lang) {
    return ChargeurJson(
        api: api,
        chemin: childId == null ? '/parent/remarks' : '/parent/children/$childId/remarks',
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
          final rows = snapshot.data?['remarks'] as List<dynamic>? ?? const [];
          if (rows.isEmpty) {
            return TabEmpty(
              icon: Icons.chat_bubble_outline,
              message: t('aucune_remarque', lang),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final r = rows[i] as Map<String, dynamic>;
              final sev = _severity(r['severity'] as String? ?? 'info');
              return GlassCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: sev.colour,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          lang == 'ar' ? sev.ar : sev.fr,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: sev.colour,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          (r['created_at'] as String? ?? '').split('T').first,
                          style: const TextStyle(fontSize: 12, color: Ocean.ink300),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(r['body'] as String? ?? '', style: const TextStyle(height: 1.45)),
                    if (r['author_name'] != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        r['author_name'] as String,
                        style: const TextStyle(fontSize: 12, color: Ocean.ink500),
                      ),
                    ],
                  ],
                ),
              );
            },
          );
        },
    );
  }
}
