import 'dart:io';
import 'dart:typed_data';

import 'package:open_filex/open_filex.dart';

/// SUR LE TÉLÉPHONE : le fichier est écrit dans le cache de l'application,
/// puis remis à l'application qui sait l'ouvrir (le lecteur PDF du téléphone,
/// la galerie…) par le fournisseur de fichiers d'`open_filex`.
///
/// ⚠ Avant ceci, l'export conditionnel choisissait le stub muet sur Android
/// (`dart.library.js_interop` n'est vrai que sur le web) : « Ouvrir » une pièce
/// jointe ne faisait rien, sans un mot.
void ouvrirDansNavigateur(Uint8List octets, String nom, String mime) {
  () async {
    final sur = nom.replaceAll(RegExp(r'[^\w.\-]+'), '_');
    final f = File('${Directory.systemTemp.path}/elourwa_$sur');
    await f.writeAsBytes(octets, flush: true);
    await OpenFilex.open(f.path, type: mime);
  }();
}
