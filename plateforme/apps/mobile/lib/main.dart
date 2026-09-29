import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'src/api.dart';
import 'src/arriere_plan.dart';
import 'src/bandeau_notification.dart';
import 'src/sonnerie.dart';
import 'src/langue.dart';
import 'src/push.dart';
import 'src/change_password_screen.dart';
import 'src/login_screen.dart';
import 'src/parent_shell.dart';
import 'src/theme.dart';
import 'src/marque.dart';

void main() => runApp(const ParentApp());

/// El Ourwa — parent space.
///
/// Parents only. Teachers use the responsive web app; there is no teacher
/// mobile app (PROJECT.md Part 5).
class ParentApp extends StatefulWidget {
  const ParentApp({super.key});

  @override
  State<ParentApp> createState() => _ParentAppState();
}

class _ParentAppState extends State<ParentApp> {
  final ApiClient _api = ApiClient();
  Future<bool>? _restored;
  Locale _locale = const Locale('fr');

  /// Vrai dès que l'URL ou l'appareil a parlé : le profil ne prime alors pas.
  bool _choixLocal = false;

  @override
  void initState() {
    super.initState();
    // Avant que la session parte : retirer le jeton demande encore le compte.
    _api.avantDeconnexion = () => Push.detacher(_api);
    // Le serveur a refusé la session (révoquée, expirée) : retour à l'écran
    // de connexion, au lieu d'une coquille qui croit encore être connectée.
    _api.onSessionLost = () {
      if (mounted) setState(() => _restored = Future.value(false));
    };
    // Persistent login: the stored refresh token is exchanged silently on
    // start, so reopening the app does not show a login screen.
    _restored = _restore();
  }

  @override
  void dispose() {
    _reprise?.cancel();
    super.dispose();
  }

  Future<bool> _restore() async {
    // La langue d'abord — URL puis appareil — pour que même l'écran de
    // connexion soit dans la bonne langue (le bouton y est, chez El Ourwa,
    // parce qu'un parent qui ne lit pas le français doit pouvoir basculer AVANT).
    final locale = await Langue.resoudreLocalement();
    if (locale != null) {
      // ⚠ DANS UN setState, PAS EN AFFECTATION NUE. `MaterialApp.locale` est lu
      // au premier build, qui se fait en français avant que ceci ne réponde ;
      // sans setState, l'application restait en LTR pendant que les écrans,
      // construits plus tard, lisaient l'arabe : moitié dans un sens, moitié
      // dans l'autre. Vu au navigateur, pas dans un test.
      _choixLocal = true;
      if (mounted) {
        setState(() => _locale = locale);
      } else {
        _locale = locale;
      }
    }
    await Push.initialiser();
    // L'adresse du serveur avant toute requête : celle de la construction, ou
    // celle que cet appareil a choisie.
    await _api.resoudreServeur();
    await _api.restore();
    if (!_api.hasSession) {
      // Une session gardée sans serveur joignable : on entre quand même, et
      // on réessaie toutes les cinq secondes (puis moins souvent) jusqu'à ce
      // que le serveur réponde — comme WhatsApp affiche « Connexion… ».
      if (_api.credentialGardee) {
        _reessayerEnBoucle();
        return true;
      }
      return false;
    }
    _appliquerProfil();
    // La permission de notifier, Firebase ou pas (Android 13+ ne sonne rien
    // sans elle) — demandée dès qu'une session existe.
    await Sonnerie.demanderPermission();
    // Un téléphone qui rouvre l'application est un téléphone qui doit encore
    // recevoir : le jeton se redéclare à chaque restauration — sans retenir le
    // premier écran (permission, jeton FCM et POST /parent/devices prenaient
    // la durée d'un aller-retour réseau sur le voyant de lancement).
    unawaited(Push.attacher(_api, _locale.languageCode, () {
      if (mounted) setState(() {});
    }));
    // Fermée, l'application va voir elle-même toutes les quinze minutes.
    unawaited(ArrierePlan.programmer());
    return true;
  }

  Timer? _reprise;
  int _epoque = 0;
  void _reessayerEnBoucle([int tentative = 0]) {
    _reprise?.cancel();
    final delai = Duration(seconds: tentative < 6 ? 5 : tentative < 20 ? 15 : 60);
    _reprise = Timer(delai, () async {
      if (!mounted) return;
      if (await _api.reessayer()) {
        unawaited(ArrierePlan.programmer());
        _appliquerProfil();
        await Push.attacher(_api, _locale.languageCode, () => setState(() {}));
        // Une nouvelle clé : la coquille se reconstruit et recharge tout.
        if (mounted) setState(() => _epoque++);
        return;
      }
      if (!_api.credentialGardee) {
        // Le serveur a répondu : la session est bel et bien révoquée.
        if (mounted) setState(() {});
        return;
      }
      _reessayerEnBoucle(tentative + 1);
    });
  }

  /// L'étape « profil » : seulement si ni l'URL ni l'appareil n'ont choisi.
  void _appliquerProfil() {
    if (_choixLocal) return;
    final profil = Langue.depuisProfil(_api.profileLocale);
    if (profil == null) return;
    // Même raison que ci-dessus : la locale de MaterialApp ne suit qu'un setState.
    if (mounted) {
      setState(() => _locale = profil);
    } else {
      _locale = profil;
    }
  }

  void _setLocale(Locale locale) {
    setState(() {
      _locale = locale;
      _choixLocal = true;
    });
    // Gardé sur l'appareil ET au profil, comme le cookie et `parents.langue`.
    Langue.memoriser(locale.languageCode);
    _api.setLocale(locale.languageCode);
  }

  void _onSignedIn() {
    setState(() {
      // Le compte vient de dire sa langue ; elle s'applique si l'appareil
      // n'a rien choisi, et le choix fait sur l'écran de connexion se
      // pousse au profil.
      _appliquerProfil();
      if (_choixLocal) _api.setLocale(_locale.languageCode);
      _restored = Future.value(true);
    });
    // Android 13+ ne sonne rien sans la permission : demandée ici aussi, pas
    // seulement au retour d'une session gardée.
    unawaited(Sonnerie.demanderPermission());
    Push.attacher(_api, _locale.languageCode, () => setState(() {}));
    unawaited(ArrierePlan.programmer());
  }

  /// ⚠ SE DÉCONNECTER, C'EST FERMER LA SESSION — pas seulement changer
  /// d'écran. Le menu et le portail « mot de passe » appelaient ceci sans
  /// `logout()` : le jeton restait, le prochain lancement reconnectait, et le
  /// téléphone continuait de recevoir les notifications de la famille.
  Future<void> _onSignedOut() async {
    BandeauNotification.fermer();
    await ArrierePlan.annuler();
    if (_api.hasSession || _api.credentialGardee) await _api.logout();
    if (!mounted) return;
    setState(() => _restored = Future.value(false));
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${Marque.nom} — Espace parents',
      debugShowCheckedModeBanner: false,
      locale: _locale,
      // French and Arabic, as El Ourwa. Arabic drives RTL for the whole tree,
      // so no layout may assume a direction.
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('fr'), Locale('ar')],
      // El Ourwa's own parent design system, "Glass Ocean" — glassmorphism over
      // an ocean-blue ramp. Deliberately nothing like the direction screens,
      // which are cream and terracotta: the two audiences never see each
      // other's, and a parent should not feel they have wandered into the
      // office.
      theme: oceanTheme(arabic: _locale.languageCode == 'ar'),
      // No dark variant. Glass over a light wash IS the design; a dark
      // inversion of it would be a different system wearing its name, and there
      // is no dark stylesheet in the reference to copy.
      // Le texte agrandi par le téléphone reste dans une fenêtre où la mise en
      // page tient (0,9 → 1,25) : lisible, jamais cassé.
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(MediaQuery.textScalerOf(context).scale(1).clamp(0.9, 1.25)),
        ),
        child: child ?? const SizedBox.shrink(),
      ),
      home: FutureBuilder<bool>(
        future: _restored,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Scaffold(
                body: Center(child: CircularProgressIndicator()));
          }
          if (snapshot.data == true && (_api.hasSession || _api.credentialGardee)) {
            /**
             * ⚠ THE GATE. An account still on the password the school issued
             * sees this and nothing else — El Ourwa's own behaviour, and ours
             * stored the flag while acting on it nowhere.
             *
             * Sign-out is offered: a parent who cannot remember the password
             * they were given must be able to leave rather than be trapped.
             */
            if (_api.mustChangePassword) {
              return ChangePasswordScreen(
                api: _api,
                lang: _locale.languageCode,
                forced: true,
                onChanged: () => setState(() {}),
                onSignOut: _onSignedOut,
              );
            }
            return ParentShell(
              key: ValueKey(_epoque),
              api: _api,
              onSignedOut: _onSignedOut,
              locale: _locale,
              onLocaleChanged: _setLocale,
            );
          }
          // ⚠ The language toggle lives ON the login screen in El Ourwa —
          // a parent who cannot read French must be able to switch BEFORE
          // signing in, not after.
          return LoginScreen(
            api: _api,
            onSignedIn: _onSignedIn,
            locale: _locale,
            onLocaleChanged: _setLocale,
          );
        },
      ),
    );
  }
}
