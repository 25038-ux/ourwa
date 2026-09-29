import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'sonnerie.dart';
import 'api.dart';
import 'marque.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// LES NOTIFICATIONS POUSSÉES — le téléphone apprend l'absence quand elle est
/// saisie, pas quand on ouvre l'application.
///
/// ⚠ FIREBASE EST INITIALISÉ PAR CODE, DEPUIS `--dart-define`. Pas de
/// `google-services.json` dans le dépôt, pas de `GoogleService-Info.plist`, pas
/// de greffon Gradle : ces fichiers portent les identifiants du projet Firebase
/// de l'école, et le dépôt est partagé. Sans les valeurs, `configure` vaut
/// `false`, l'application se construit et tourne exactement comme avant — elle
/// interroge, elle ne reçoit pas. Avec, elle reçoit.
///
/// ```bash
/// flutter build appbundle \
///   --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… \
///   --dart-define=FIREBASE_PROJECT_ID=… --dart-define=FIREBASE_SENDER_ID=… \
///   --dart-define=FIREBASE_VAPID_KEY=…      # web seulement
/// ```
///
/// ⚠ LE JETON EST UNE CLÉ, PAS UNE ADRESSE. Il ouvre l'écran de ce téléphone.
/// Il part au serveur sous le compte connecté (`POST /parent/devices`), il est
/// retiré à la déconnexion (`DELETE`), et il ne s'affiche ni ne se journalise.
///
/// ⚠ ET CHAQUE ÉTAPE SE LIT (23/09/2026 : « notifications are far from
/// instant » sans qu'on sache si le téléphone avait seulement déclaré son
/// jeton). [etat] dit ce qui est en place — compilé, permis, jeton obtenu,
/// déclaré au serveur — et le profil l'affiche ; [redeclarerSiBesoin]
/// réessaie la déclaration à chaque sondage tant qu'elle n'a pas abouti (le
/// premier essai part souvent avant que le réseau ne soit prêt).
class Push {
  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const _vapid = String.fromEnvironment('FIREBASE_VAPID_KEY');

  static bool get configure =>
      _apiKey.isNotEmpty && _appId.isNotEmpty && _projectId.isNotEmpty && _senderId.isNotEmpty;

  static String? _jeton;

  /// Le jeton a été DÉCLARÉ au serveur (POST /parent/devices réussi).
  static bool _declare = false;

  /// Le dernier refus, en un mot, pour le profil : `permission`, `firebase`,
  /// `reseau`, ou nul.
  static String? derniereErreur;

  /// Le SERVEUR pousse par Firebase (il a sa clé) — dit par la réponse de
  /// `POST /parent/devices`. ⚠ « Déclaré » ne voulait pas dire « livré » : le
  /// téléphone coupait ses deux sondages dès que le jeton était accepté, et un
  /// serveur sans clé ne poussait rien — plus aucune notification, ouverte ou
  /// fermée (la démonstration, avant que sa clé soit posée).
  static bool _livraisonFirebase = false;

  /// Firebase porte les notifications de cet appareil (jeton déclaré ET serveur
  /// qui pousse) : le sondage ne doit alors pas sonner une seconde fois.
  static bool get actif => _jeton != null && _declare && _livraisonFirebase;

  /// Le jeton de ce téléphone (pour `POST /parent/devices/status`), ou nul.
  static String? get jeton => _jeton;

  /// L'état, pour le profil.
  static ({bool compile, bool jetonObtenu, bool declare, String? erreur}) get etat =>
      (compile: configure, jetonObtenu: _jeton != null, declare: _declare, erreur: derniereErreur);

  static const _cleLivraison = 'push_actif';

  /// Gardé sur l'appareil, pour la tâche de fond (un autre isolat, où [actif] est faux).
  static Future<void> _memoriserLivraison(bool oui) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_cleLivraison, oui);
    } catch (_) {}
  }

  static Future<bool> livreParFirebase() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_cleLivraison) ?? false;
    } catch (_) {
      return false;
    }
  }
  static StreamSubscription<String>? _rotation;
  static StreamSubscription<RemoteMessage>? _premierPlan;
  static StreamSubscription<RemoteMessage>? _ouverture;
  static void Function()? _onMessage;

  /// Ce que la coquille veut faire quand une notification est TOUCHÉE
  /// (application en arrière-plan ou fermée) : ouvrir la cloche.
  static void Function(String? route)? surOuverture;

  /// Au démarrage, avant tout : sans configuration, ne fait rien et ne gêne rien.
  static Future<void> initialiser() async {
    if (!configure) return;
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: _apiKey,
          appId: _appId,
          projectId: _projectId,
          messagingSenderId: _senderId,
        ),
      );
    } catch (_) {
      // Une initialisation qui échoue — projet mal renseigné — ne doit pas
      // empêcher de consulter les notes. L'application reste celle d'avant.
      derniereErreur = 'firebase';
    }
  }

  /// Après la connexion : demander la permission, prendre le jeton, le déclarer.
  /// `onMessage` reçoit ce qui arrive pendant que l'application est ouverte —
  /// le badge se rafraîchit sans attendre le prochain tour du minuteur.
  static Future<void> attacher(ApiClient api, String lang, void Function() onMessage) async {
    if (!configure || !api.hasSession) return;
    _onMessage = onMessage;
    try {
      final messaging = FirebaseMessaging.instance;
      final permission = await messaging.requestPermission(alert: true, badge: true, sound: true);
      if (permission.authorizationStatus == AuthorizationStatus.denied) {
        derniereErreur = 'permission';
        return;
      }

      final jeton = await messaging.getToken(vapidKey: kIsWeb && _vapid.isNotEmpty ? _vapid : null);
      if (jeton != null) {
        await _declarer(api, jeton, lang);
      } else {
        derniereErreur = 'firebase';
      }

      _rotation?.cancel();
      _rotation = messaging.onTokenRefresh.listen((nouveau) => _declarer(api, nouveau, lang));

      _premierPlan?.cancel();
      // Au premier plan, Android n'affiche rien et ne sonne pas : on le fait
      // nous-mêmes, sur le même canal (son + vibration), avec le texte reçu.
      _premierPlan = FirebaseMessaging.onMessage.listen((m) {
        final n = m.notification;
        if (n != null) Sonnerie.afficher(n.title ?? Marque.nom, n.body ?? '');
        onMessage();
      });

      // Touchée depuis la barre — application en arrière-plan, ou fermée
      // (message initial) : la coquille ouvre la cloche.
      _ouverture?.cancel();
      _ouverture = FirebaseMessaging.onMessageOpenedApp.listen((m) => surOuverture?.call(m.data['route'] as String?));
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        Future<void>.delayed(const Duration(milliseconds: 600), () => surOuverture?.call(initial.data['route'] as String?));
      }
    } catch (_) {
      // Pas de permission, pas de réseau, pas de service Google sur cet
      // appareil : l'application interroge, comme avant.
      derniereErreur ??= 'firebase';
    }
  }

  /// Le jeton existe mais le serveur ne l'a pas encore : réessayer (appelé à
  /// chaque sondage de la coquille).
  static Future<void> redeclarerSiBesoin(ApiClient api, String lang) async {
    if (!api.hasSession) return;
    final jeton = _jeton;
    if (jeton == null) {
      // Permission refusée au premier essai puis accordée dans les réglages,
      // ou services Google indisponibles un instant : on refait le tour.
      if (configure && _onMessage != null && (derniereErreur == 'permission' || derniereErreur == 'firebase')) {
        await attacher(api, lang, _onMessage!);
      }
      return;
    }
    if (_declare) return;
    await _declarer(api, jeton, lang);
  }

  static Future<void> _declarer(ApiClient api, String jeton, String lang) async {
    _jeton = jeton;
    final platform = kIsWeb
        ? 'web'
        : defaultTargetPlatform == TargetPlatform.iOS
            ? 'ios'
            : 'android';
    try {
      final r = await api.post('/parent/devices', {'platform': platform, 'token': jeton, 'locale': lang});
      _declare = true;
      derniereErreur = null;
      // Le serveur dit s'il pousse ; un serveur d'avant (sans `push`) est tenu
      // pour poussant, comme avant.
      _livraisonFirebase = (r['push'] as String?) != 'sondage';
      await _memoriserLivraison(_livraisonFirebase);
    } catch (_) {
      // Le prochain sondage, le prochain rafraîchissement de jeton, ou la
      // prochaine connexion réessaiera.
      _declare = false;
      derniereErreur = 'reseau';
    }
  }

  /// À la déconnexion : ce téléphone ne reçoit plus rien pour ce compte.
  static Future<void> detacher(ApiClient api) async {
    _rotation?.cancel();
    _premierPlan?.cancel();
    _ouverture?.cancel();
    final jeton = _jeton;
    _jeton = null;
    _declare = false;
    _livraisonFirebase = false;
    await _memoriserLivraison(false);
    if (jeton == null || !api.hasSession) return;
    try {
      await api.delete('/parent/devices', {'token': jeton});
    } catch (_) {
      // Le serveur retirera le jeton de lui-même à la première réponse UNREGISTERED.
    }
  }
}
