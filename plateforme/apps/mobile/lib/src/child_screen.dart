import 'package:flutter/material.dart';
import 'api.dart';
import 'i18n.dart';
import 'report_card_screen.dart';
import 'theme.dart';
import 'tabs/absences_tab.dart';
import 'tabs/emploi_tab.dart';
import 'tabs/remarques_tab.dart';
import 'dashboard_screen.dart';

/// LA FICHE D'UN ENFANT — `pages/parent/enfant.php`.
///
/// ⚠ FOUR SECTIONS, AND WE HAD THREE. Its pill tab bar reads
///
///     📊 Bulletin · 📅 Absences · 💬 Remarques · 🗓️ Emploi du temps
///
/// and the fourth did not exist in this app at all. A family wanting to know
/// when their child has Arabic on a Tuesday had nowhere to look.
///
/// Reached by tapping a child on the dashboard, which is where its own
/// `onclick="window.location.href='enfant.php?id=…'"` sends you.
class ChildScreen extends StatefulWidget {
  const ChildScreen({
    super.key,
    required this.api,
    required this.child,
    required this.lang,
  });

  final ApiClient api;
  final Child child;
  final String lang;

  @override
  State<ChildScreen> createState() => _ChildScreenState();
}

class _ChildScreenState extends State<ChildScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 4, vsync: this);

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.lang;
    // Sous 480 dp (tous les téléphones), les deux grands chiffres passent
    // sous le nom : sur une ligne de 294 dp ils en laissaient 54 au nom.
    final etroit = MediaQuery.sizeOf(context).width < 480;
    final chiffres = <Widget>[
      _Chiffre(
        valeur: '${widget.child.absences}',
        libelle: t('totalabsences', lang),
        alerte: widget.child.absences > 5,
      ),
      const SizedBox(width: 8),
      _Chiffre(
        // La moyenne est retenue quand la famille a une dette :
        // le serveur ne l'envoie pas, et « — » est la réponse.
        valeur: widget.child.average == null ? '—' : formatAverage(widget.child.average!),
        libelle: t('moyenne', lang),
        alerte: widget.child.average != null &&
            (double.tryParse(widget.child.average!) ?? 20) < 10,
      ),
    ];

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: Ocean.backdrop),
        child: SafeArea(
          child: Column(
            children: [
              // Its own back link: "← Accueil", not a bare chevron.
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back, size: 18),
                  label: Text(t('accueil', lang)),
                  style: TextButton.styleFrom(foregroundColor: Ocean.c700),
                ),
              ),

              // ⚠ SA CARTE D'EN-TÊTE, ET ELLE PORTE DEUX GRANDS CHIFFRES.
              // `enfant.php` ouvre sur une `g-card` en ligne : l'initiale de
              // l'enfant dans un rond de 64 px, son nom, le bouton du bulletin
              // officiel, « niveau · groupe », le matricule — puis, à droite,
              // le TOTAL D'ABSENCES et la MOYENNE en 2,4 rem, chacun virant au
              // rouge à son seuil (plus de 5 absences, moyenne sous 10).
              //
              // Nous n'affichions que le nom et la classe. Les deux chiffres
              // qu'un parent vient chercher — combien de fois mon enfant a
              // manqué, où il en est — n'étaient nulle part sur sa fiche.
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: GlassCard(
                  child: Column(children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(colors: [Ocean.c400, Ocean.c700]),
                          shape: BoxShape.circle,
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          widget.child.firstName.isEmpty
                              ? '?'
                              : widget.child.firstName.characters.first.toUpperCase(),
                          style: const TextStyle(
                            fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'],
                            fontSize: 26,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.child.fullName,
                              style: const TextStyle(
                                fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'],
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                                color: Ocean.ink900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            // Son bouton « 📄 Bulletin officiel (imprimable) ».
                            // L'onglet Bulletin montre les moyennes ; celui-ci
                            // ouvre la pièce que l'école signe et que la famille
                            // imprime. Les deux existent chez lui.
                            TextButton(
                              onPressed: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => ReportCardScreen(
                                    api: widget.api,
                                    child: widget.child,
                                    isArabic: lang == 'ar',
                                  ),
                                ),
                              ),
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                backgroundColor: Ocean.c700,
                                foregroundColor: Colors.white,
                              ),
                              child: Text(
                                '📄 ${t('bulletin_officiel', lang)}',
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              [
                                if (widget.child.levelName != null) widget.child.levelName!,
                                if (widget.child.groupName != null) widget.child.groupName!,
                              ].join(' · '),
                              style: const TextStyle(fontSize: 13, color: Ocean.ink500),
                            ),
                            if (widget.child.classRank > 0)
                              Text(
                                '${t('matricule', lang)} : N°${widget.child.classRank}',
                                style: const TextStyle(fontSize: 12, color: Ocean.ink500),
                              ),
                          ],
                        ),
                      ),
                      // Sur un téléphone les deux chiffres passent sous le nom :
                      // 240 dp fixes sur une ligne de 294 écrasaient le nom
                      // lettre par lettre.
                      if (!etroit) ...chiffres,
                    ],
                  ),
                  if (etroit) ...[
                    const SizedBox(height: 10),
                    Row(mainAxisAlignment: MainAxisAlignment.end, children: chiffres),
                  ],
                  ]),
                ),
              ),

              // ⚠ Its pill tabs, in its order, with its emoji.
              TabBar(
                controller: _tabs,
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                labelColor: Ocean.c700,
                unselectedLabelColor: Ocean.ink500,
                indicatorColor: Ocean.c500,
                tabs: [
                  Tab(text: '📊 ${t('bulletin', lang)}'),
                  Tab(text: '📅 ${t('absences', lang)}'),
                  Tab(text: '💬 ${t('remarques', lang)}'),
                  Tab(text: '🗓️ ${t('emploi_du_temps', lang)}'),
                ],
              ),

              Expanded(
                child: TabBarView(
                  controller: _tabs,
                  children: [
                    ReportCardScreen(
                      api: widget.api,
                      child: widget.child,
                      isArabic: lang == 'ar',
                      embedded: true,
                    ),
                    AbsencesTab(api: widget.api, lang: lang, childId: widget.child.id),
                    RemarquesTab(api: widget.api, lang: lang, childId: widget.child.id),
                    EmploiTab(api: widget.api, childId: widget.child.id, lang: lang),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// UN DES DEUX GRANDS CHIFFRES DE L'EN-TÊTE — 2,4 rem chez lui, et rouge à son
/// seuil : plus de 5 absences, ou une moyenne sous 10. La couleur est le
/// message ; le libellé en petites capitales le nomme.
class _Chiffre extends StatelessWidget {
  const _Chiffre({required this.valeur, required this.libelle, required this.alerte});

  final String valeur;
  final String libelle;
  final bool alerte;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 78,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            valeur,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 26,
              height: 1,
              fontWeight: FontWeight.w800,
              color: alerte ? Ocean.danger : Ocean.c700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            libelle.toUpperCase(),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: .5,
              color: Ocean.ink500,
            ),
          ),
        ],
      ),
    );
  }
}
