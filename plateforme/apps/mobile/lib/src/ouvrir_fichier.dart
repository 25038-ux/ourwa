/// REMETTRE UN FICHIER DÉJÀ TÉLÉCHARGÉ AU NAVIGATEUR.
///
/// ⚠ DERRIÈRE UN EXPORT CONDITIONNEL, et il le faut. L'implémentation réelle
/// s'appuie sur `dart:js_interop` et `package:web`, qui n'existent que sur le
/// web. Sans cette indirection, `flutter test` — qui compile pour la VM Dart —
/// ne compile plus DU TOUT : ajouter la visionneuse de pièces jointes a cassé
/// les 40 tests d'un coup, sans rapport avec ce qu'ils vérifient.
library;

export 'ouvrir_fichier_stub.dart'
    if (dart.library.js_interop) 'ouvrir_fichier_web.dart'
    if (dart.library.io) 'ouvrir_fichier_io.dart';
