import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';

/// SONDAGE DES NOTIFICATIONS — RYTHME ADAPTATIF.
///
/// Port de `assets/js/notifications.js`, ses quatre règles comprises.
///
/// ⚠ L'APPLICATION NE DEMANDAIT SES NOTIFICATIONS QU'UNE SEULE FOIS, au
/// démarrage. Une famille qui ouvrait l'application et la laissait ouverte ne
/// voyait jamais rien arriver : la pastille restait sur le chiffre qu'elle
/// portait au lancement, et un message de l'école n'apparaissait qu'après avoir
/// tué puis rouvert l'application. « Instantané » n'était pas lent — il
/// n'existait pas.
///
/// Ses quatre règles, et la raison de chacune :
///
///   1. DÉCALAGE ALÉATOIRE. Huit cents téléphones réveillés à la même minute —
///      la publication des bulletins — reviendraient sinon tous à la même
///      seconde, indéfiniment.
///
///   2. ARRÊT COMPLET QUAND L'APPLICATION N'EST PAS REGARDÉE. C'est la plus
///      grande économie, et sur un téléphone elle se compte aussi en batterie
///      et en forfait. Au retour, on interroge tout de suite, sans jamais
///      descendre sous 20 secondes.
///
///   3. RALENTISSEMENT PROGRESSIF EN CAS D'ERREUR, jusqu'à dix minutes. Un
///      serveur en difficulté ne doit pas recevoir davantage de trafic à cause
///      de son propre échec.
///
///   4. RYTHME PLUS SOUTENU PENDANT CINQ MINUTES après une nouvelle. Une
///      famille qui reçoit des nouvelles obtient de la réactivité ; une famille
///      inactive ne coûte rien.
///
/// ⚠ POURQUOI PAS UNE CONNEXION MAINTENUE. Son propre commentaire donne la
/// raison, et elle vaut pour nous : « Le serveur accepte 35 requêtes PHP
/// simultanées. Une requête qui attend occupe un de ces 35 emplacements. »
/// Notre API tient davantage de connexions, mais le raisonnement de fond ne
/// change pas — 1 372 familles tenant chacune une connexion ouverte est un coût
/// permanent pour un événement rare. Le jour où l'école voudra du vrai temps
/// réel, la réponse est une notification poussée par le système (APNs / FCM),
/// pas une connexion que l'application garde ouverte.
class NotificationsPoller with WidgetsBindingObserver {
  NotificationsPoller({
    required this.onPoll,
    this.onError,
  });

  /// Ce qu'il faut aller chercher. Rend `true` s'il y a du nouveau — ce qui
  /// déclenche la règle 4.
  final Future<bool> Function() onPoll;

  /// Appelé quand un appel échoue, pour que l'écran puisse cesser de promettre
  /// un chiffre qu'il n'a pas vérifié.
  final void Function()? onError;

  // Ses constantes, à la milliseconde près.
  static const _intervalleBase = Duration(milliseconds: 30000);
  static const _decalageMax = 30000; // + 0 à 30 s
  // ⚠ 30 s chez lui (une page web) ; 15 s ici : l'application ouverte doit
  // sonner dans les secondes qui suivent une notification (décision du
  // propriétaire, 18/09 — sans Firebase, c'est le sondage qui porte le son).
  static const _intervalleActif = Duration(milliseconds: 15000);
  static const _dureeActivite = Duration(milliseconds: 300000);
  static const _attenteMax = Duration(milliseconds: 600000);
  static const _delaiMinimal = Duration(milliseconds: 10000);

  final _alea = Random();
  Timer? _minuteur;
  DateTime _dernierAppel = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _finActivite = DateTime.fromMillisecondsSinceEpoch(0);
  int _echecs = 0;
  bool _enCours = false;
  bool _arrete = false;
  bool _cache = false;

  void demarrer() {
    WidgetsBinding.instance.addObserver(this);
    _interroger(forcer: true); // premier appel immédiat
  }

  void arreter() {
    _arrete = true;
    _minuteur?.cancel();
    _minuteur = null;
    WidgetsBinding.instance.removeObserver(this);
  }

  /// À appeler après une action locale — avoir lu ses notifications, par
  /// exemple. Son `reveiller()`.
  void reveiller() => _interroger(forcer: true);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // `resumed` est le seul état où l'écran est devant la personne. `inactive`
    // couvre le volet de notifications à demi tiré et l'appel entrant : on
    // s'arrête là aussi, comme le fait `document.hidden`.
    final cache = state != AppLifecycleState.resumed;
    if (cache == _cache) return;
    _cache = cache;

    if (cache) {
      _minuteur?.cancel();
      _minuteur = null;
    } else {
      // De retour : on regarde tout de suite, sans descendre sous le délai
      // minimal — c'est `_interroger` qui le fait respecter.
      _interroger();
    }
  }

  /// Le délai avant le prochain appel, décalage compris.
  Duration _prochainDelai() {
    final decalage = Duration(milliseconds: _alea.nextInt(_decalageMax));
    if (_echecs > 0) {
      // 2^n, plafonné : 75 s, 150 s, 300 s, 600 s, 600 s…
      final attente = _intervalleBase * pow(2, _echecs).toDouble();
      return (attente > _attenteMax ? _attenteMax : attente) + decalage;
    }
    final base =
        DateTime.now().isBefore(_finActivite) ? _intervalleActif : _intervalleBase;
    return base + decalage;
  }

  void _planifier() {
    _minuteur?.cancel();
    _minuteur = null;
    if (_arrete || _cache) return; // règle 2 : rien tant qu'on ne regarde pas
    _minuteur = Timer(_prochainDelai(), _interroger);
  }

  Future<void> _interroger({bool forcer = false}) async {
    if (_arrete || _enCours) return;
    if (_cache && !forcer) return;

    final depuis = DateTime.now().difference(_dernierAppel);
    if (!forcer && depuis < _delaiMinimal) {
      _planifier();
      return;
    }

    _enCours = true;
    _dernierAppel = DateTime.now();
    try {
      final duNouveau = await onPoll();
      _echecs = 0;
      if (duNouveau) {
        _finActivite = DateTime.now().add(_dureeActivite); // règle 4
      }
    } catch (_) {
      _echecs = _echecs >= 4 ? 4 : _echecs + 1; // règle 3
      onError?.call();
    } finally {
      _enCours = false;
      _planifier();
    }
  }
}
