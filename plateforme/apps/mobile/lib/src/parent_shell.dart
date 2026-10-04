import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'sonnerie.dart';
import 'arriere_plan.dart';
import 'bandeau_notification.dart';
import 'push.dart';
import 'api.dart';
import 'dashboard_screen.dart';
import 'documents_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'i18n.dart';
import 'messages_screen.dart';
import 'notifications_poller.dart';
import 'notifications_screen.dart';
import 'theme.dart';
import 'tabs/absences_tab.dart';
import 'tabs/exercices_tab.dart';
import 'tabs/profil_tab.dart';
import 'tabs/remarques_tab.dart';
import 'tabs/resultats_tab.dart';
import 'marque.dart';

/// L'ESPACE CORRESPONDANT — `includes/parent_layout_header.php`.
///
/// ⚠ ON A PHONE ITS BOTTOM BAR HOLDS FIVE, NOT SEVEN, AND IN A DIFFERENT ORDER:
///
///     Accueil · Résultats · Exercices · Absences · Messages
///
/// I had built seven, in the order of its DESKTOP tab bar. That bar
/// (`.parent-nav`) is `display: none` under its mobile breakpoint;
/// `.parent-bottom-nav` takes over with five. Seven labels do not fit across a
/// phone without truncating, and it is the desktop bar that is the odd one out.
///
/// ⚠ WHICH LEAVES REMARQUES AND PROFIL WITH NO ROUTE ON A PHONE. On the web
/// that is survivable — a parent can turn the handset or open a laptop. This app
/// has no wider layout to fall back to, so following the bar exactly would
/// DELETE two features rather than relocate them. They go in the header, beside
/// the language toggle and the sign-out that already live there. The bar matches
/// its bar; the feature set matches its feature set.
class ParentShell extends StatefulWidget {
  const ParentShell({
    super.key,
    required this.api,
    required this.onSignedOut,
    required this.locale,
    required this.onLocaleChanged,
  });

  final ApiClient api;
  final VoidCallback onSignedOut;
  final Locale locale;
  final ValueChanged<Locale> onLocaleChanged;

  @override
  State<ParentShell> createState() => _ParentShellState();
}

class _ParentShellState extends State<ParentShell> {
  int _index = 0;
  int _unread = 0;

  /// ⚠ A SECOND COUNTER, AND IT IS NOT THE SAME ONE. `_unread` counts MESSAGES
  /// — the messagerie, a person writing to a person. This counts the event
  /// stream: an absence recorded, an exercise given, a timetable published.
  /// Adding them together would put a number on the bell that matches nothing
  /// the family can then find.
  int _unreadNotifs = 0;

  /// ⚠ L'APPLICATION NE DEMANDAIT SES NOTIFICATIONS QU'UNE FOIS, AU LANCEMENT.
  /// Une famille qui laissait l'application ouverte ne voyait jamais rien
  /// arriver : la pastille restait sur le chiffre du démarrage, et un message
  /// de l'école n'apparaissait qu'après avoir tué puis rouvert l'application.
  NotificationsPoller? _poller;
  bool _premierSondageFait = false;

  /// « Documents » dans le menu latéral : seulement pour une famille d'une école
  /// qui facture par service (Jinan, ADR-0080). Le dernier verdict est gardé
  /// sur le téléphone pour que l'entrée soit là dès l'ouverture.
  bool _documentsActifs = false;
  final GlobalKey<ScaffoldState> _echafaudage = GlobalKey<ScaffoldState>();

  Future<void> _verifierDocuments() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final avant = prefs.getBool('documents_actifs') ?? false;
      if (avant && mounted) setState(() => _documentsActifs = true);
      final r = await widget.api.get('/parent/documents');
      final actif = r['actif'] == true;
      await prefs.setBool('documents_actifs', actif);
      await prefs.setString(DocumentsScreen.cleCache, jsonEncode(r));
      if (mounted && actif != _documentsActifs) setState(() => _documentsActifs = actif);
    } catch (_) {
      // Hors ligne : on garde ce qu'on savait.
    }
  }

  @override
  void initState() {
    super.initState();
    // Une notification touchée dans la barre (application en arrière-plan ou
    // fermée) ouvre la cloche.
    Push.surOuverture = _surOuverture;
    _poller = NotificationsPoller(
      onPoll: _sonder,
      // Un badge qu'on n'a pas pu vérifier ne montre rien, plutôt qu'un zéro
      // dont on ne sait rien — la même règle que ci-dessous.
      onError: () {},
    )..demarrer();
    unawaited(_verifierDocuments());
  }

  /// Une méthode, comparée par `==` : quand la coquille est remplacée (clé
  /// `_epoque`, main.dart), l'ancienne est détruite APRÈS que la nouvelle a posé
  /// le sien — on ne retire que le nôtre (deux extractions de la même méthode
  /// sur le même objet sont égales ; celles de deux coquilles ne le sont pas).
  void _surOuverture(String? _) {
    if (mounted) _ouvrirNotifications();
  }

  @override
  void dispose() {
    BandeauNotification.fermer();
    if (Push.surOuverture == _surOuverture) Push.surOuverture = null;
    _poller?.arreter();
    super.dispose();
  }

  /// Un seul aller-retour pour les deux compteurs, et il dit s'il y a du neuf —
  /// c'est ce qui déclenche le rythme soutenu pendant cinq minutes.
  Future<bool> _sonder() async {
    final avant = _unread + _unreadNotifs;
    // Le jeton Firebase obtenu mais pas encore déclaré (réseau absent au
    // lancement) : réessayer à chaque tour, jusqu'à ce que le serveur le tienne.
    unawaited(Push.redeclarerSiBesoin(widget.api, widget.locale.languageCode));
    final compte = await Future.wait([
      widget.api.unreadCount(),
      widget.api.notificationsUnread(),
    ]);
    if (!mounted) return false;
    unawaited(ArrierePlan.battre());
    // Ne reconstruire que si un compte a changé : chaque `setState` rebâtit
    // les onglets, et un onglet sans état relançait sa requête (la liste des
    // exercices clignotait à chaque sondage).
    if (compte[0] != _unread || compte[1] != _unreadNotifs) {
      setState(() {
        _unread = compte[0];
        _unreadNotifs = compte[1];
      });
    }
    final duNouveau = (compte[0] + compte[1]) > avant;
    // Sans Firebase, c'est le sondage qui découvre l'arrivée : la notification
    // SURGIT avec son vrai texte — « Nouvelle note : Français », « Exercice
    // “…” pour Ahmed » — une par élément nouveau (trois au plus, puis un
    // résumé), et un nouveau message de la messagerie sonne de même. Le
    // premier tour ne sonne pas (`avant` vaut 0, tout serait « nouveau »).
    if (duNouveau && _premierSondageFait && !Push.actif) {
      unawaited(_surgir(compte[0] - (avant - _unreadNotifsAvant), compte[1] - _unreadNotifsAvant));
    }
    _unreadNotifsAvant = compte[1];
    _premierSondageFait = true;
    return duNouveau;
  }

  int _unreadNotifsAvant = 0;
  final Set<String> _dejaSurgies = {};

  /// `nouvellesNotifs` : combien de non-lues EN PLUS depuis le sondage
  /// précédent. Seules les plus récentes, en ce nombre, surgissent — pas les
  /// anciennes non lues (une famille qui en gardait douze en recevait trois
  /// d'un coup, plus un résumé, pour une seule vraie nouveauté).
  Future<void> _surgir(int nouveauxMessages, int nouvellesNotifs) async {
    final lang = widget.locale.languageCode;
    try {
      if (nouvellesNotifs > 0) {
        final r = await widget.api.notifications();
        final nonLues = r.items.where((n) => n.readAt == null).toList();
        // Les listes arrivent des plus récentes aux plus anciennes.
        final fraiches = nonLues.where((n) => !_dejaSurgies.contains(n.id)).take(nouvellesNotifs).toList();
        for (final n in nonLues) {
          if (!fraiches.contains(n)) _dejaSurgies.add(n.id);
        }
        final aMontrer = fraiches.take(3).toList();
        for (final (i, n) in aMontrer.indexed) {
          final texte = notificationTexte(n.i18nKey, n.params, lang);
          await Sonnerie.afficher(texte.titre, texte.corps);
          // Dans l'application aussi : le bandeau qui descend, pour qui a
          // l'écran sous les yeux — la première seulement, le reste attend
          // dans la cloche.
          if (i == 0 && mounted) {
            BandeauNotification.montrer(
              context,
              titre: texte.titre,
              corps: texte.corps,
              icone: iconeNotification(n.kind),
              teinte: teinteNotification(n.kind),
              onTap: () { if (mounted) _ouvrirNotifications(); },
            );
          }
          _dejaSurgies.add(n.id);
        }
        // La tâche de fond ne remontre pas ce qui vient de surgir ici.
        unawaited(ArrierePlan.marquerVues(nonLues.map((n) => n.id)));
        if (fraiches.length > 3) {
          final reste = fraiches.length - 3;
          await Sonnerie.afficher(t('notifications', lang), t('nouvelles_notifications', lang).replaceAll('{n}', '$reste'));
          for (final n in fraiches) {
            _dejaSurgies.add(n.id);
          }
        }
      }
      if (nouveauxMessages > 0) {
        final corps = nouveauxMessages == 1 ? t('nouveau_message_corps', lang) : t('nouveaux_messages', lang).replaceAll('{n}', '$nouveauxMessages');
        await Sonnerie.afficher(t('messages', lang), corps);
        if (mounted) {
          BandeauNotification.montrer(context, titre: t('messages', lang), corps: corps, icone: Icons.mail_outline_rounded, onTap: () { if (mounted) setState(() => _index = 2); });
        }
      }
    } catch (_) {
      await Sonnerie.afficher(t('notifications', lang), t('nouvelle_notification', lang));
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.locale.languageCode;
    final arabic = lang == 'ar';

    // ⚠ ITS FIVE, IN ITS ORDER. Exercices before Absences, which is not the
    // desktop order and is deliberate: on a phone the middle slot is the
    // easiest to reach with a thumb. Tout le reste — Documents, Remarques,
    // Notifications, Profil, la langue, la sortie — vit dans le menu latéral
    // (« Jardin », 04/10/2026), au lieu d'un menu caché derrière un avatar.
    final destinations = <({String key, IconData icon, IconData selected})>[
      (key: 'accueil', icon: Icons.home_outlined, selected: Icons.home_rounded),
      (key: 'resultats', icon: Icons.insights_outlined, selected: Icons.insights_rounded),
      (key: 'exercices', icon: Icons.menu_book_outlined, selected: Icons.menu_book_rounded),
      (key: 'absences', icon: Icons.event_busy_outlined, selected: Icons.event_busy_rounded),
      (key: 'messages', icon: Icons.chat_bubble_outline_rounded, selected: Icons.chat_bubble_rounded),
    ];

    final pages = <Widget>[
      DashboardScreen(
        api: widget.api,
        onSignedOut: widget.onSignedOut,
        locale: widget.locale,
        onLocaleChanged: widget.onLocaleChanged,
        embedded: true,
      ),
      ResultatsTab(api: widget.api, lang: lang),
      ExercicesTab(api: widget.api, lang: lang),
      AbsencesTab(api: widget.api, lang: lang),
      MessagesScreen(api: widget.api, isArabic: arabic),
    ];

    return Scaffold(
      key: _echafaudage,
      extendBody: true,
      backgroundColor: Ocean.ivoire,
      drawer: _MenuLateral(
        lang: lang,
        index: _index,
        unread: _unread,
        unreadNotifs: _unreadNotifs,
        documentsActifs: _documentsActifs,
        destinations: [for (final d in destinations) (key: d.key, icon: d.icon)],
        onSection: (i) {
          Navigator.of(context).pop();
          setState(() => _index = i);
        },
        onDocuments: () {
          Navigator.of(context).pop();
          _open(DocumentsScreen(api: widget.api, lang: lang), 'documents');
        },
        onRemarques: () {
          Navigator.of(context).pop();
          _open(RemarquesTab(api: widget.api, lang: lang), 'remarques');
        },
        onNotifications: () {
          Navigator.of(context).pop();
          _ouvrirNotifications();
        },
        onProfil: () {
          Navigator.of(context).pop();
          _open(
            ProfilTab(
              api: widget.api,
              lang: lang,
              onSignedOut: widget.onSignedOut,
              onLocaleChanged: widget.onLocaleChanged,
            ),
            'profil',
          );
        },
        onToggleLanguage: () {
          Navigator.of(context).pop();
          widget.onLocaleChanged(arabic ? const Locale('fr') : const Locale('ar'));
        },
        onSignOut: () {
          Navigator.of(context).pop();
          widget.onSignedOut();
        },
      ),
      body: Container(
        decoration: const BoxDecoration(gradient: Ocean.backdrop),
        child: Column(
          children: [
            _TopBar(
              lang: lang,
              titre: t(destinations[_index].key, lang),
              unreadNotifs: _unreadNotifs,
              onMenu: () => _echafaudage.currentState?.openDrawer(),
              onNotifications: () => _ouvrirNotifications(),
            ),
            Expanded(
              child: ContenuLarge(
                child: AnimatedSwitcher(
                  duration: Ocean.med,
                  switchInCurve: Ocean.ease,
                  transitionBuilder: (child, anim) => FadeTransition(
                    opacity: anim,
                    child: SlideTransition(
                      position: Tween(begin: const Offset(0, .02), end: Offset.zero).animate(anim),
                      child: child,
                    ),
                  ),
                  child: KeyedSubtree(key: ValueKey(_index), child: pages[_index]),
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(Ocean.rLg),
            border: Border.all(color: Ocean.ligne),
            boxShadow: Ocean.shadowLg,
          ),
          clipBehavior: Clip.antiAlias,
          child: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (i) {
              HapticFeedback.selectionClick();
              setState(() => _index = i);
              // Ouvrir Messages remet le compteur à jour tout de suite, sans
              // attendre le prochain tour du sondage.
              if (destinations[i].key == 'messages') _poller?.reveiller();
            },
            destinations: [
              for (final d in destinations)
                NavigationDestination(
                  icon: d.key == 'messages' && _unread > 0
                      ? Badge(label: Text('$_unread'), child: Icon(d.icon))
                      : Icon(d.icon),
                  selectedIcon: d.key == 'messages' && _unread > 0
                      ? Badge(label: Text('$_unread'), child: Icon(d.selected))
                      : Icon(d.selected),
                  label: t(d.key, lang),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// The two screens its bottom bar cannot hold, opened over the shell.

  /// Le fil des notifications — poussé directement, PAS par `_open` (qui
  /// enveloppe la page d'un Scaffold : deux barres de titre superposées).
  Future<void> _ouvrirNotifications() async {
    final lang = widget.locale.languageCode;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Container(
          decoration: const BoxDecoration(gradient: Ocean.backdrop),
          child: NotificationsScreen(api: widget.api, lang: lang),
        ),
      ),
    );
    // Coming back from the stream, the badge must reflect what was read
    // there — not what it said before.
    _poller?.reveiller();
  }

  void _open(Widget page, String titleKey) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: Ocean.ivoire,
          appBar: AppBar(title: Text(t(titleKey, widget.locale.languageCode))),
          body: Container(
            decoration: const BoxDecoration(gradient: Ocean.backdrop),
            child: page,
          ),
        ),
      ),
    );
  }
}

/// L'EN-TÊTE « JARDIN » — un bandeau émeraude aux coins bas arrondis : le
/// menu latéral à l'ouverture de ligne, la marque et la section courante, la
/// cloche avec son compte. (Il remplace la pilule blanche de « Glass Ocean »,
/// dont le menu derrière l'avatar cachait quatre sections.)
class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.lang,
    required this.titre,
    required this.unreadNotifs,
    required this.onMenu,
    required this.onNotifications,
  });

  final String lang;
  final String titre;
  final int unreadNotifs;
  final VoidCallback onMenu;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) {
    final haut = MediaQuery.paddingOf(context).top;
    return Container(
      padding: EdgeInsetsDirectional.fromSTEB(8, haut + 8, 8, 14),
      decoration: const BoxDecoration(
        gradient: Ocean.entete,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(Ocean.rLg)),
        boxShadow: Ocean.shadow,
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: t('menu', lang),
            onPressed: onMenu,
            icon: const Icon(Icons.menu_rounded, color: Colors.white),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  Marque.selon(lang),
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.white.withValues(alpha: .78), fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: .4),
                ),
                Text(
                  titre,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'], color: Colors.white, fontSize: 21, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: t('notifications', lang),
            onPressed: onNotifications,
            style: IconButton.styleFrom(backgroundColor: Colors.white.withValues(alpha: .14)),
            icon: Badge(
              isLabelVisible: unreadNotifs > 0,
              label: Text('$unreadNotifs'),
              backgroundColor: Ocean.or,
              textColor: Ocean.ink900,
              child: const Icon(Icons.notifications_none_rounded, color: Colors.white),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

/// LE MENU LATÉRAL — « documents button in the sidebar » : toutes les
/// sections de l'espace, dans l'ordre de la barre du bas, puis Documents,
/// Remarques, Notifications, Profil, la langue et la sortie.
class _MenuLateral extends StatelessWidget {
  const _MenuLateral({
    required this.lang,
    required this.index,
    required this.unread,
    required this.unreadNotifs,
    required this.documentsActifs,
    required this.destinations,
    required this.onSection,
    required this.onDocuments,
    required this.onRemarques,
    required this.onNotifications,
    required this.onProfil,
    required this.onToggleLanguage,
    required this.onSignOut,
  });

  final String lang;
  final int index;
  final int unread;
  final int unreadNotifs;
  final bool documentsActifs;
  final List<({String key, IconData icon})> destinations;
  final ValueChanged<int> onSection;
  final VoidCallback onDocuments;
  final VoidCallback onRemarques;
  final VoidCallback onNotifications;
  final VoidCallback onProfil;
  final VoidCallback onToggleLanguage;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    Widget entree(IconData icone, String libelle, VoidCallback onTap, {bool actif = false, int compte = 0, Color? couleur}) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        child: Material(
          color: actif ? Ocean.c100 : Colors.transparent,
          borderRadius: BorderRadius.circular(Ocean.rSm),
          child: ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rSm)),
            leading: Icon(icone, color: couleur ?? (actif ? Ocean.c700 : Ocean.ink500)),
            title: Text(
              libelle,
              style: TextStyle(fontWeight: actif ? FontWeight.w700 : FontWeight.w600, color: couleur ?? (actif ? Ocean.c800 : Ocean.ink900)),
            ),
            trailing: compte > 0 ? Pastille(texte: '$compte', couleur: Ocean.orFonce) : null,
            onTap: onTap,
          ),
        ),
      );
    }

    return Drawer(
      width: 300,
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              margin: const EdgeInsets.fromLTRB(10, 10, 10, 12),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(gradient: Ocean.entete, borderRadius: BorderRadius.circular(Ocean.rMd)),
              child: Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: .16), borderRadius: BorderRadius.circular(Ocean.rSm)),
                    child: const Icon(Icons.local_florist_rounded, color: Ocean.or, size: 26),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          Marque.selon(lang),
                          style: const TextStyle(fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'], color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                        ),
                        Text(
                          lang == 'ar' ? 'فضاء الأولياء' : 'Espace parents',
                          style: TextStyle(color: Colors.white.withValues(alpha: .8), fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            for (final (i, d) in destinations.indexed)
              entree(d.icon, t(d.key, lang), () => onSection(i), actif: i == index, compte: d.key == 'messages' ? unread : 0),
            const Padding(padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8), child: Divider()),
            if (documentsActifs) entree(Icons.folder_shared_outlined, t('documents', lang), onDocuments, couleur: Ocean.c700),
            entree(Icons.rate_review_outlined, t('remarques', lang), onRemarques),
            entree(Icons.notifications_none_rounded, t('notifications', lang), onNotifications, compte: unreadNotifs),
            entree(Icons.person_outline_rounded, t('profil', lang), onProfil),
            const Padding(padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8), child: Divider()),
            entree(Icons.translate_rounded, t('langue_changer', lang), onToggleLanguage),
            entree(Icons.logout_rounded, t('deconnexion', lang), onSignOut, couleur: Ocean.danger),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

String salutation(String lang, [DateTime? now]) {
  final h = (now ?? DateTime.now()).hour;
  if (lang == 'ar') {
    if (h < 5) return 'مساء الخير';
    if (h < 12) return 'صباح الخير';
    if (h < 18) return 'مرحباً';
    return 'مساء الخير';
  }
  if (h < 5) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}
