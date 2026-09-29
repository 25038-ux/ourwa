import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elourwa_parent/src/notifications_poller.dart';

/// LE SONDAGE DES NOTIFICATIONS — `assets/js/notifications.js`.
///
/// ⚠ L'APPLICATION NE DEMANDAIT SES NOTIFICATIONS QU'UNE FOIS, AU LANCEMENT.
/// Une famille qui la laissait ouverte ne voyait jamais rien arriver. Ce que ces
/// tests tiennent, ce n'est donc pas un détail de rythme : c'est le fait qu'il y
/// ait un rythme.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('interroge immédiatement au démarrage', () async {
    var appels = 0;
    final p = NotificationsPoller(onPoll: () async {
      appels++;
      return false;
    })..demarrer();

    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(appels, 1);
    p.arreter();
  });

  test('⚠ règle 2 : ne sonde plus quand l’application n’est pas regardée',
      () async {
    var appels = 0;
    final p = NotificationsPoller(onPoll: () async {
      appels++;
      return false;
    })..demarrer();

    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(appels, 1);

    // Mise en arrière-plan : le minuteur est annulé, plus rien ne part.
    p.didChangeAppLifecycleState(AppLifecycleState.paused);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(appels, 1, reason: 'un sondage est parti alors que l’écran est caché');

    // Retour au premier plan : on regarde tout de suite. Le délai minimal de
    // 20 s ne s’applique pas à un retour forcé… mais si, justement : le dernier
    // appel date de moins de 20 s, donc il replanifie au lieu d’appeler.
    p.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(appels, 1,
        reason: 'deux appels à moins de 20 s d’intervalle — son DELAI_MINIMAL');

    p.arreter();
  });

  test('⚠ `inactive` compte comme caché, pas seulement `paused`', () async {
    // Le volet de notifications à demi tiré, un appel entrant : l’écran n’est
    // plus devant la personne. `document.hidden` couvre ces cas-là.
    var appels = 0;
    final p = NotificationsPoller(onPoll: () async {
      appels++;
      return false;
    })..demarrer();
    await Future<void>.delayed(const Duration(milliseconds: 50));

    p.didChangeAppLifecycleState(AppLifecycleState.inactive);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(appels, 1);
    p.arreter();
  });

  test('« réveiller » force un appel, quel que soit le délai écoulé', () async {
    var appels = 0;
    final p = NotificationsPoller(onPoll: () async {
      appels++;
      return false;
    })..demarrer();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(appels, 1);

    // Après avoir lu ses notifications : le compteur doit descendre tout de
    // suite, sans attendre soixante-quinze secondes.
    p.reveiller();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(appels, 2);
    p.arreter();
  });

  test('⚠ un échec ne remonte pas, et n’arrête pas le sondage', () async {
    var appels = 0;
    var erreurs = 0;
    final p = NotificationsPoller(
      onPoll: () async {
        appels++;
        throw Exception('réseau');
      },
      onError: () => erreurs++,
    )..demarrer();

    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(appels, 1);
    expect(erreurs, 1, reason: 'l’échec doit être signalé, pas avalé');

    // Et il replanifie : `arreter()` est le seul moyen de l’arrêter.
    p.reveiller();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(appels, 2);
    p.arreter();
  });

  test('arreter() coupe tout, y compris un réveil ultérieur', () async {
    var appels = 0;
    final p = NotificationsPoller(onPoll: () async {
      appels++;
      return false;
    })..demarrer();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    p.arreter();

    p.reveiller();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(appels, 1, reason: 'un poller arrêté a continué à sonder');
  });
}
