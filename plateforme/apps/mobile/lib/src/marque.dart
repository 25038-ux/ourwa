/// LA MARQUE — le nom sous lequel l'application se présente.
///
/// « El Ourwa » par défaut ; une construction peut se présenter sous un autre
/// nom (« El Mourad ») par `--dart-define=BRAND_NAME=… --dart-define=BRAND_NAME_AR=…`,
/// sans qu'une ligne de code change. Tout ce qui est visible — l'écran de
/// connexion, la barre du haut, les notifications, le bandeau, le bulletin sans
/// école — lit ces deux constantes. Le nom Android (`android:label`) et
/// l'identifiant du paquet suivent `APP_LABEL` / `APP_ID` dans `build.gradle` ;
/// le nom iOS, `APP_DISPLAY_NAME` dans les `.xcconfig`.
///
/// Les identifiants techniques (canal de notification, clés de stockage, nom
/// du paquet Dart) ne changent pas : ils ne sont visibles de personne et une
/// application déjà installée les garde.
class Marque {
  static const String nom = String.fromEnvironment('BRAND_NAME', defaultValue: 'El Ourwa');
  static const String nomAr = String.fromEnvironment('BRAND_NAME_AR', defaultValue: 'العروة');

  /// Le nom dans la langue de l'écran.
  static String selon(String lang) => lang == 'ar' ? nomAr : nom;
}
