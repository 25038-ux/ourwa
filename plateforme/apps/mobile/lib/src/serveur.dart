import 'package:shared_preferences/shared_preferences.dart';

/// L'ADRESSE DU SERVEUR — celle de la construction, sauf si ce téléphone en a
/// choisi une autre.
///
/// ⚠ IL N'Y A PAS ENCORE DE SERVEUR DE PRODUCTION. Un paquet publié qui ne
/// connaît que `API_URL` au moment de sa construction serait donc mort à
/// l'arrivée : `localhost:3001` sur un téléphone, c'est le téléphone. Le jour
/// où le serveur existe, il suffit de le saisir ici, sans reconstruire ni
/// republier — et la même porte sert à viser un serveur de test.
///
/// ⚠ HTTPS SEULEMENT, ET AFFICHÉ SUR L'ÉCRAN DE CONNEXION. Une adresse
/// modifiable est une porte : un parent qu'on convainc de pointer l'application
/// vers un autre serveur y taperait son mot de passe. On ne peut pas l'empêcher
/// — un navigateur a la même porte — mais on refuse le clair, et l'adresse en
/// cours est lisible sous le formulaire, pas cachée.
///
/// Le choix vit sur l'appareil (`SharedPreferences`). Il n'est pas secret : ce
/// n'est pas un jeton, c'est une adresse.
class Serveur {
  static const _cle = 'serveur';

  /// Ce que la construction a reçu. `localhost` en développement.
  static const parDefaut = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3001');

  /// L'adresse en vigueur : celle choisie sur cet appareil, sinon celle de la construction.
  static Future<String> resoudre() async {
    final prefs = await SharedPreferences.getInstance();
    final choisie = prefs.getString(_cle);
    return (choisie != null && valider(choisie) == null) ? choisie : parDefaut;
  }

  /// `null` si l'adresse est acceptable, sinon la raison — en français, la
  /// personne qui la saisit est de l'école.
  static String? valider(String brut) {
    final v = brut.trim();
    final uri = Uri.tryParse(v);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) return 'Adresse incomplète.';
    // Le clair n'est toléré que vers la machine de développement.
    final local = uri.host == 'localhost' || uri.host == '127.0.0.1' || uri.host == '10.0.2.2';
    if (uri.scheme != 'https' && !local) return 'Le serveur doit être en https.';
    if (uri.scheme != 'https' && uri.scheme != 'http') return 'Le serveur doit être en https.';
    return null;
  }

  static Future<void> choisir(String adresse) async {
    final prefs = await SharedPreferences.getInstance();
    final v = adresse.trim().replaceAll(RegExp(r'/+$'), '');
    if (v.isEmpty || v == parDefaut) {
      await prefs.remove(_cle);
    } else {
      await prefs.setString(_cle, v);
    }
  }
}
