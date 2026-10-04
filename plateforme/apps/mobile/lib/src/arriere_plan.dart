import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import 'api.dart';
import 'i18n.dart';
import 'langue.dart';
import 'marque.dart';
import 'push.dart';

/// LES NOTIFICATIONS QUAND L'APPLICATION EST FERMÉE — sans Firebase.
///
/// Le sondage de la coquille ne vit que lorsque l'application est ouverte :
/// fermée ou en arrière-plan, RIEN ne surgissait (« notifications don't pop
/// up in android »). Sans projet Firebase configuré (aucune clé sur la
/// démonstration), le téléphone doit aller voir lui-même : une tâche
/// périodique (WorkManager, au plus toutes les quinze minutes — le minimum
/// d'Android) ouvre la session gardée, lit les notifications, et fait
/// SURGIR celles que personne n'a encore vues — par le même canal
/// « elourwa_v2 » (carillon, vibration, heads-up) que le premier plan.
///
/// Ce qui a déjà surgi, au premier plan ou ici, est noté dans les
/// préférences (`notifs_vues`) : jamais deux fois la même. Quand Firebase
/// est configuré, il livre à la seconde et cette tâche ne trouve rien de neuf.
class ArrierePlan {
  static const tache = 'mr.elourwa.parent.sondage';
  static const canal = 'elourwa_v2';
  static const _cleVues = 'notifs_vues';
  static const _cleMessages = 'messages_non_lus_vus';
  static const _cleBattement = 'sondage_premier_plan_a';

  /// Le premier plan bat à chaque sondage : la tâche de fond se tait tant
  /// que le battement est récent. Les deux partagent UN jeton de
  /// rafraîchissement et tourneraient sinon en même temps — le second est une
  /// « réutilisation », la famille de jetons est révoquée, le parent déconnecté.
  static Future<void> battre() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_cleBattement, DateTime.now().millisecondsSinceEpoch);
    } catch (_) {}
  }

  static Future<bool> premierPlanActif() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final dernier = prefs.getInt(_cleBattement) ?? 0;
      return DateTime.now().millisecondsSinceEpoch - dernier < 2 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }

  static final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

  static Future<void> _initLocal() async {
    await _local.initialize(
      const InitializationSettings(android: AndroidInitializationSettings('ic_notification')),
    );
    // Le canal est créé par MainActivity à l'ouverture ; la tâche de fond peut
    // tourner sans que l'activité ait jamais vécu depuis une mise à jour —
    // un canal absent, et Android jette la notification sans un mot. Le
    // recréer à l'identique est sans effet s'il existe déjà.
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
          AndroidNotificationChannel(
            canal,
            Marque.nom,
            description: 'Notes, absences, exercices, messages et paiements',
            importance: Importance.max,
            sound: const RawResourceAndroidNotificationSound('elourwa_notif'),
            enableVibration: true,
            vibrationPattern: Int64List.fromList(const [0, 250, 120, 250]),
            enableLights: true,
            showBadge: true,
          ),
        );
  }

  /// Enregistre la tâche périodique (idempotente : `replace`).
  static Future<void> programmer() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await Workmanager().initialize(tacheArrierePlan);
      await Workmanager().registerPeriodicTask(
        tache,
        tache,
        frequency: const Duration(minutes: 15),
        existingWorkPolicy: ExistingWorkPolicy.update,
        constraints: Constraints(networkType: NetworkType.connected),
        backoffPolicy: BackoffPolicy.linear,
        backoffPolicyDelay: const Duration(minutes: 5),
      );
    } catch (_) {
      // Tests, ou une plateforme sans le pont natif : rien à programmer.
    }
  }

  static Future<void> annuler() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await Workmanager().cancelByUniqueName(tache);
    } catch (_) {}
  }

  /// Le premier plan a montré ces notifications : la tâche de fond ne les remontre pas.
  static Future<void> marquerVues(Iterable<String> ids) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final vues = (prefs.getStringList(_cleVues) ?? const <String>[]).toSet()..addAll(ids);
      // Les 500 plus RÉCENTES (les nouvelles s'ajoutent en fin) : garder les
      // plus anciennes aurait fini par ne plus rien noter.
      final liste = vues.toList();
      await prefs.setStringList(_cleVues, liste.length > 500 ? liste.sublist(liste.length - 500) : liste);
    } catch (_) {}
  }

  static Future<Set<String>> vues() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return (prefs.getStringList(_cleVues) ?? const <String>[]).toSet();
    } catch (_) {
      return <String>{};
    }
  }

  /// Le corps de la tâche : session gardée → nouveautés → notifications.
  /// Rend vrai (la tâche a fini), même sans réseau : WorkManager réessaiera.
  static Future<bool> sonder() async {
    // L'application est ouverte et sonde elle-même : ne pas rafraîchir en
    // parallèle (voir `battre`).
    if (await premierPlanActif()) return true;
    // Firebase porte les notifications de cet appareil (jeton déclaré, voir
    // Push._declarer) : les remontrer quinze minutes plus tard, c'est sonner deux fois.
    if (await Push.livreParFirebase()) return true;
    final api = ApiClient();
    await api.resoudreServeur();
    if (!await api.refresh()) return true;
    final locale = await Langue.resoudreLocalement();
    final lang = (locale?.languageCode ?? api.profileLocale ?? 'fr') == 'ar' ? 'ar' : 'fr';
    await _initLocal();

    // Les notifications non lues et jamais montrées, les plus récentes d'abord.
    final r = await api.notifications();
    final deja = await vues();
    final fraiches = r.items.where((n) => n.readAt == null && !deja.contains(n.id)).toList();
    var id = 5000;
    for (final n in fraiches.take(3)) {
      final texte = notificationTexte(n.i18nKey, n.params, lang);
      await _montrer(id++, texte.titre, texte.corps);
    }
    if (fraiches.length > 3) {
      await _montrer(id++, t('notifications', lang), t('nouvelles_notifications', lang).replaceAll('{n}', '${fraiches.length - 3}'));
    }
    await marquerVues(fraiches.map((n) => n.id));

    // Les messages de l'école : un compte, une notification quand il monte.
    try {
      final prefs = await SharedPreferences.getInstance();
      final nonLus = await api.unreadCount();
      final avant = prefs.getInt(_cleMessages) ?? 0;
      if (nonLus > avant) {
        final delta = nonLus - avant;
        await _montrer(id++, t('messages', lang), delta == 1 ? t('nouveau_message_corps', lang) : t('nouveaux_messages', lang).replaceAll('{n}', '$delta'));
      }
      await prefs.setInt(_cleMessages, nonLus);
    } catch (_) {}
    return true;
  }

  static Future<void> _montrer(int id, String titre, String corps) async {
    await _local.show(
      id,
      titre,
      corps,
      NotificationDetails(
        android: AndroidNotificationDetails(
          canal,
          Marque.nom,
          channelDescription: 'Notes, absences, exercices, messages et paiements',
          importance: Importance.max,
          priority: Priority.high,
          category: AndroidNotificationCategory.message,
          visibility: NotificationVisibility.public,
          ticker: '$titre — $corps',
          styleInformation: BigTextStyleInformation(corps),
          sound: const RawResourceAndroidNotificationSound('elourwa_notif'),
          vibrationPattern: Int64List.fromList(const [0, 250, 120, 250]),
          color: const Color(0xFF157252),
          icon: 'ic_notification',
        ),
      ),
    );
  }
}

/// Le point d'entrée de WorkManager — hors de toute classe, gardé vivant
/// pour le tree-shaking par `vm:entry-point`.
@pragma('vm:entry-point')
void tacheArrierePlan() {
  Workmanager().executeTask((task, inputData) async {
    try {
      return await ArrierePlan.sonder();
    } catch (_) {
      return true;
    }
  });
}
