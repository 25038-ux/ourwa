import 'dart:js_interop';
import 'dart:typed_data';
import 'package:web/web.dart' as web;

/// REMETTRE UN FICHIER DÉJÀ TÉLÉCHARGÉ AU NAVIGATEUR.
///
/// ⚠ ON NE PEUT PAS SIMPLEMENT OUVRIR L'URL. `/attachments/:id` exige l'en-tête
/// d'autorisation — un onglet ouvert sur cette adresse recevrait un 401. Les
/// octets ont donc déjà été lus par le client authentifié ; ici on les
/// enveloppe dans un blob local et c'est CELUI-LÀ qu'on ouvre. Rien ne repart
/// sur le réseau, et le jeton ne se retrouve jamais dans une URL.
///
/// L'URL du blob est révoquée après coup : chacune retient son contenu en
/// mémoire tant qu'elle vit, et un parent qui ouvre dix pièces jointes ne doit
/// pas en garder dix.
void ouvrirDansNavigateur(Uint8List octets, String nom, String mime) {
  final blob = web.Blob(
    [octets.toJS].toJS,
    web.BlobPropertyBag(type: mime),
  );
  final url = web.URL.createObjectURL(blob);
  final lien = web.document.createElement('a') as web.HTMLAnchorElement
    ..href = url
    ..target = '_blank'
    ..rel = 'noopener'
    ..download = nom;
  web.document.body?.append(lien);
  lien.click();
  lien.remove();
  web.URL.revokeObjectURL(url);
}
