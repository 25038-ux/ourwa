import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// LA SONNERIE ET LA VIBRATION — comme WhatsApp : un parent sait, sans
/// regarder, qu'il vient de recevoir quelque chose.
///
/// Sur Android c'est le canal « elourwa » (MainActivity.kt) qui porte le son
/// et le motif de vibration : Firebase l'utilise pour ce qui arrive quand
/// l'application est fermée, et ceci l'utilise pour ce qui arrive quand elle
/// est ouverte (un message reçu au premier plan ne sonne pas tout seul) et
/// pour ce que le sondage découvre quand Firebase n'est pas configuré.
class Sonnerie {
  static const _canal = MethodChannel('mr.elourwa.parent/notifs');
  static int _compteur = 100;

  /// Affiche une notification locale (son + vibration du canal).
  static Future<void> afficher(String titre, String corps) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _canal.invokeMethod('afficher', {'titre': titre, 'corps': corps, 'id': _compteur++});
    } on MissingPluginException {
      // Tests, ou une plateforme sans le pont natif.
    } catch (_) {}
  }

  /// Demande la permission d'afficher des notifications (Android 13+).
  /// Rend vrai si elle est accordée (ou sans objet sur cette version).
  static Future<bool> demanderPermission() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return true;
    try {
      final r = await _canal.invokeMethod<String>('demanderPermission');
      return r == 'accordee';
    } catch (_) {
      return false;
    }
  }

  static Future<bool> permissionAccordee() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return true;
    try {
      return await _canal.invokeMethod<bool>('permissionAccordee') ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> vibrer() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _canal.invokeMethod('vibrer');
    } catch (_) {}
  }
}
