import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'sonnerie.dart';
import 'arriere_plan.dart';
import 'bandeau_notification.dart';
import 'push.dart';
import 'api.dart';
import 'dashboard_screen.dart';
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
    // easiest to reach with a thumb.
    final destinations = <({String key, IconData icon})>[
      (key: 'accueil', icon: Icons.home_outlined),
      (key: 'resultats', icon: Icons.bar_chart_outlined),
      (key: 'exercices', icon: Icons.menu_book_outlined),
      (key: 'absences', icon: Icons.calendar_today_outlined),
      (key: 'messages', icon: Icons.chat_bubble_outline),
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
      extendBody: true,
      body: Container(
        decoration: const BoxDecoration(gradient: Ocean.backdrop),
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _TopBar(
                lang: lang,
                unread: _unread,
                unreadNotifs: _unreadNotifs,
                onNotifications: () => _ouvrirNotifications(),
                onToggleLanguage: () => widget.onLocaleChanged(
                  arabic ? const Locale('fr') : const Locale('ar'),
                ),
                onRemarques: () => _open(RemarquesTab(api: widget.api, lang: lang), 'remarques'),
                onProfil: () => _open(
                  ProfilTab(
                    api: widget.api,
                    lang: lang,
                    onSignedOut: widget.onSignedOut,
                    onLocaleChanged: widget.onLocaleChanged,
                  ),
                  'profil',
                ),
                onSignOut: widget.onSignedOut,
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
      ),
      bottomNavigationBar: NavigationBar(
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
              label: t(d.key, lang),
            ),
        ],
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

/// Its floating header card — `.parent-top`.
///
/// A white pill sitting on the cyan wash, carrying the mark, the notification
/// bell with its unread count, and the way out. The language toggle is here
/// because a parent who cannot read the interface cannot navigate to a settings
/// page to fix that.
class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.lang,
    required this.unread,
    required this.unreadNotifs,
    required this.onNotifications,
    required this.onToggleLanguage,
    required this.onRemarques,
    required this.onProfil,
    required this.onSignOut,
  });

  final String lang;
  final int unread;
  final int unreadNotifs;
  final VoidCallback onNotifications;
  final VoidCallback onToggleLanguage;
  final VoidCallback onRemarques;
  final VoidCallback onProfil;
  final VoidCallback onSignOut;

  /// ⚠ SIX CONTRÔLES SUR UNE LIGNE NE TIENNENT PAS SUR UN PETIT TÉLÉPHONE.
  /// La barre garde la marque, la cloche (avec son compte) et un menu ; la
  /// langue, les remarques, le profil et la déconnexion vivent dans ce menu —
  /// et dans le profil, où elles étaient déjà.
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(Ocean.rLg),
          boxShadow: Ocean.shadow,
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Ocean.c400, Ocean.c600]),
                borderRadius: BorderRadius.circular(Ocean.rSm),
              ),
              child: const Icon(Icons.school_outlined, size: 21, color: Colors.white),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                Marque.selon(lang),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'Fraunces',
                  fontWeight: FontWeight.w700,
                  fontSize: 17,
                  color: Ocean.ink900,
                ),
              ),
            ),
            IconButton(
              tooltip: t('notifications', lang),
              onPressed: onNotifications,
              style: IconButton.styleFrom(backgroundColor: Ocean.c50, shape: const CircleBorder()),
              icon: Badge(
                isLabelVisible: unreadNotifs > 0,
                label: Text('$unreadNotifs'),
                backgroundColor: Ocean.danger,
                child: const Icon(Icons.notifications_none_rounded, color: Ocean.ink700),
              ),
            ),
            const SizedBox(width: 4),
            PopupMenuButton<String>(
              tooltip: t('profil', lang),
              position: PopupMenuPosition.under,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rMd)),
              onSelected: (v) {
                switch (v) {
                  case 'profil':
                    onProfil();
                  case 'remarques':
                    onRemarques();
                  case 'langue':
                    onToggleLanguage();
                  case 'deconnexion':
                    onSignOut();
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'profil', child: ListTile(dense: true, leading: const Icon(Icons.person_outline), title: Text(t('profil', lang)))),
                PopupMenuItem(value: 'remarques', child: ListTile(dense: true, leading: const Icon(Icons.rate_review_outlined), title: Text(t('remarques', lang)))),
                PopupMenuItem(value: 'langue', child: ListTile(dense: true, leading: const Icon(Icons.translate), title: Text(lang == 'ar' ? 'Français' : 'العربية'))),
                const PopupMenuDivider(),
                PopupMenuItem(value: 'deconnexion', child: ListTile(dense: true, leading: const Icon(Icons.logout, color: Ocean.danger), title: Text(t('deconnexion', lang), style: const TextStyle(color: Ocean.danger)))),
              ],
              child: Container(
                width: 38,
                height: 38,
                decoration: const BoxDecoration(color: Ocean.c100, shape: BoxShape.circle),
                child: const Icon(Icons.person_rounded, color: Ocean.c700, size: 22),
              ),
            ),
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
