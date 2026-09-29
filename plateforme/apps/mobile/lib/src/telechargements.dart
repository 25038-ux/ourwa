import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:open_filex/open_filex.dart';

/// ENREGISTRER UN DOCUMENT DANS « TÉLÉCHARGEMENTS », PUIS L'OUVRIR.
///
/// « The bulletins is not downloadable » (23/09/2026) : le bouton remettait le
/// PDF à la feuille de partage, et une famille qui cherchait le fichier dans
/// ses téléchargements ne l'y trouvait pas. Ici, sur Android 10+, le fichier
/// est déposé dans le dossier Téléchargements du téléphone par le MediaStore
/// (aucune permission de stockage nécessaire — le manifeste n'en déclare
/// toujours que deux), puis ouvert par le lecteur PDF du téléphone. Avant
/// Android 10, et sur iOS, il est écrit dans le cache de l'application et
/// ouvert de la même façon (`open_filex`) : la famille l'enregistre ou le
/// partage depuis le lecteur.
class Telechargements {
  static const _canal = MethodChannel('mr.elourwa.parent/notifs');

  /// Rend `telechargements` (déposé dans Téléchargements et ouvert),
  /// `ouvert` (écrit dans le cache et ouvert) ou `echec`.
  static Future<String> enregistrerEtOuvrir(String nom, Uint8List octets, String mime) async {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      try {
        final r = await _canal.invokeMethod<String>('enregistrerTelechargement', {
          'nom': nom,
          'mime': mime,
          'octets': octets,
        });
        if (r == 'telechargements') return r!;
      } on MissingPluginException {
        // Tests : pas de pont natif.
      } catch (_) {
        // Android < 10, ou un MediaStore récalcitrant : le cache, ci-dessous.
      }
    }
    try {
      final sur = nom.replaceAll(RegExp(r'[^\w.\-]+'), '_');
      final f = File('${Directory.systemTemp.path}/elourwa_$sur');
      await f.writeAsBytes(octets, flush: true);
      final res = await OpenFilex.open(f.path, type: mime);
      return res.type == ResultType.done ? 'ouvert' : 'echec';
    } catch (_) {
      return 'echec';
    }
  }
}
