import 'package:flutter/material.dart';
import '../api.dart';
import '../i18n.dart';
import '../theme.dart';

/// L'EMPLOI DU TEMPS DE LA CLASSE — LA GRILLE DU SITE, LA MÊME.
///
/// Décision du propriétaire (2026-09-19) : l'emploi du temps du téléphone
/// partage l'interface de « Gestion de scolarité / Emploi du temps » du site
/// (`scolarite/emploi/grille.tsx`, son `edt-grille`) : les jours en colonnes
/// (les SEPT, dimanche compris — « un cours placé le dimanche restait
/// invisible pour les parents »), les trois créneaux en lignes, l'en-tête
/// terre cuite sur blanc, la case remplie en dégradé crème avec son filet
/// terre cuite, la matière en gras et le professeur en petit dessous. Les
/// couleurs sont celles de sa feuille (`--o-accent`, `--o-a-100/200`,
/// `--o-n-*`), pas celles de l'application : c'est un document de l'école.
///
/// Sept colonnes ne tiennent pas sur un téléphone : la grille défile
/// horizontalement, la colonne des créneaux reste fixe, et le jour courant est
/// souligné pour qu'un parent trouve « aujourd'hui » d'un coup d'œil.
class EmploiTab extends StatefulWidget {
  const EmploiTab({super.key, required this.api, required this.childId, required this.lang});

  final ApiClient api;
  final String childId;
  final String lang;

  @override
  State<EmploiTab> createState() => _EmploiTabState();
}

class _EmploiTabState extends State<EmploiTab> {
  late Future<Map<String, dynamic>> _future;

  /// ⚠ Its `$JOURS`, all seven.
  static const _joursFr = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  static const _joursAr = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];

  /// Its `$CRENEAUX`.
  static const _creneaux = ['8h-9h45', '10h-11h45', '12h-14h'];

  // Sa feuille : terre cuite, crème, encre.
  static const _accent = Color(0xFFC67139); // --o-accent
  static const _a100 = Color(0xFFFFF2EB); // --o-a-100
  static const _a200 = Color(0xFFFFE1D0); // --o-a-200
  static const _bg = Color(0xFFF5EAD8); // --o-bg
  static const _n300 = Color(0xFFDCD3C4); // --o-n-300 (--border)
  static const _n700 = Color(0xFF645C50); // --o-n-700 (--text-light)
  static const _ink = Color(0xFF201E1D); // --o-ink

  static const _largeurCreneau = 84.0;
  static const _largeurJour = 140.0; // son `minWidth: 140`
  static const _hauteurCase = 88.0; // son bouton « + Ajouter » fait 80 + marges

  @override
  void initState() {
    super.initState();
    _future = widget.api.get('/parent/children/${widget.childId}/timetable');
  }

  Future<void> _recharger() async {
    setState(() => _future = widget.api.get('/parent/children/${widget.childId}/timetable'));
    await _future.catchError((_) => <String, dynamic>{});
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.lang;
    final jours = lang == 'ar' ? _joursAr : _joursFr;
    final aujourdhui = DateTime.now().weekday; // 1 = lundi … 7 = dimanche

    return FutureBuilder<Map<String, dynamic>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Squelette(lignes: 3, hauteur: 96);
        }
        if (snap.hasError) {
          return EtatVide(
            icone: Icons.cloud_off_rounded,
            titre: lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
            texte: t('erreur_reseau', lang),
            action: FilledButton.icon(onPressed: _recharger, icon: const Icon(Icons.refresh), label: Text(lang == 'ar' ? 'إعادة المحاولة' : 'Réessayer')),
          );
        }
        final slots = (snap.data?['slots'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
        if (slots.isEmpty) {
          return EtatVide(icone: Icons.calendar_month_outlined, titre: t('aucun_cours', lang));
        }

        // (jour, créneau) → la case ; ISO : 1 = lundi … 7 = dimanche.
        final cases = <int, Map<String, dynamic>>{};
        for (final s in slots) {
          final d = (s['day_of_week'] as num).toInt();
          final c = (s['slot'] as num).toInt();
          cases[d * 10 + c] = s;
        }

        Widget enTeteJour(int jour) => Container(
              width: _largeurJour,
              height: 44,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: _accent,
                border: Border.all(color: _n300, width: .5),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(jours[jour - 1], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13.5)),
                  if (jour == aujourdhui)
                    Container(margin: const EdgeInsets.only(top: 3), width: 26, height: 3, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(2))),
                ],
              ),
            );

        Widget enTeteCreneau(String libelle, {double hauteur = _hauteurCase}) => Container(
              width: _largeurCreneau,
              height: hauteur,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: _bg, border: Border.all(color: _n300, width: .5)),
              child: Text(libelle, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: _ink)),
            );

        Widget cellule(int jour, int creneau) {
          final c = cases[jour * 10 + creneau];
          return Container(
            width: _largeurJour,
            height: _hauteurCase,
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(color: Colors.white, border: Border.all(color: _n300, width: .5)),
            child: c == null
                ? const SizedBox.shrink()
                : Container(
                    padding: const EdgeInsets.fromLTRB(9, 8, 8, 8),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [_a100, _a200]),
                      borderRadius: BorderRadius.circular(8),
                      border: const Border(left: BorderSide(color: _accent, width: 4)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('${c['subject'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: _accent, fontWeight: FontWeight.w700, fontSize: 13)),
                        if (c['teacher'] != null && '${c['teacher']}'.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text('${c['teacher']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: _n700, fontSize: 11.5)),
                        ],
                      ],
                    ),
                  ),
          );
        }

        return ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
          children: [
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(Ocean.rMd),
                border: Border.all(color: _n300),
              ),
              clipBehavior: Clip.antiAlias,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // La colonne des créneaux reste en place quand les jours défilent.
                  Column(
                    children: [
                      enTeteCreneau('', hauteur: 44),
                      for (final cr in _creneaux) enTeteCreneau(cr),
                    ],
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Column(
                        children: [
                          Row(children: [for (var j = 1; j <= 7; j++) enTeteJour(j)]),
                          for (var c = 1; c <= _creneaux.length; c++)
                            Row(children: [for (var j = 1; j <= 7; j++) cellule(j, c)]),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Text(
              lang == 'ar' ? 'اسحب الجدول جانبياً لرؤية بقية الأيام.' : 'Faites glisser la grille pour voir les autres jours.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: _n700),
            ),
          ],
        );
      },
    );
  }
}
