import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// LA LANGUE, RÉSOLUE COMME EL OURWA LA RÉSOUT — `includes/i18n.php` :
///
///   1. `?lang=fr|ar` dans l'URL — et le choix est gardé ;
///   2. la session — ici, la mémoire de l'application en cours ;
///   3. le cookie `EDUPLAT_LANG` — ici, `SharedPreferences`, qui est au
///      téléphone ce que le cookie est au navigateur : local à l'appareil ;
///   4. le profil, `parents.langue` — ici `users.locale`, que `/auth/me` rend,
///      et qui suit la famille d'un appareil à l'autre ;
///   5. `fr`.
///
/// ⚠ AVANT, L'APPLICATION S'OUVRAIT EN FRANÇAIS À CHAQUE FOIS. Le bouton de
/// langue changeait l'écran et ne gardait rien : la mère qui lit l'arabe
/// rebasculait chaque matin. Chez El Ourwa le choix tient un an dans le
/// cookie, et pour toujours dans le profil.
///
/// L'ordre importe : une URL explicite gagne sur tout, un choix fait sur cet
/// appareil gagne sur le profil, et le profil ne s'applique que si l'appareil
/// n'a rien dit — sans quoi un parent qui a choisi le français sur la tablette
/// familiale la verrait repasser en arabe parce que l'autre parent a choisi
/// l'arabe sur son téléphone.
class Langue {
  static const _cle = 'langue';
  static const _valides = {'fr', 'ar'};

  /// Les étapes 1 et 3 — ce qui se sait AVANT toute connexion.
  static Future<Locale?> resoudreLocalement() async {
    // 1. L'URL, sur le web seulement : `Uri.base` est l'adresse de la page.
    final depuisUrl = Uri.base.queryParameters['lang'];
    if (depuisUrl != null && _valides.contains(depuisUrl)) {
      await memoriser(depuisUrl);
      return Locale(depuisUrl);
    }
    // 3. Le choix gardé sur cet appareil.
    final prefs = await SharedPreferences.getInstance();
    final gardee = prefs.getString(_cle);
    if (gardee != null && _valides.contains(gardee)) return Locale(gardee);
    return null;
  }

  /// L'étape 4 — le profil, quand l'appareil n'a rien dit.
  static Locale? depuisProfil(String? locale) {
    if (locale != null && _valides.contains(locale)) return Locale(locale);
    return null;
  }

  /// Garder le choix sur l'appareil (le « cookie »).
  static Future<void> memoriser(String code) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cle, code);
  }
}
