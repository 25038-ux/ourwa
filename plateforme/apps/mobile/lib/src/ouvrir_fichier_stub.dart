import 'dart:typed_data';

/// Hors du web, il n'y a pas de navigateur à qui remettre le fichier.
///
/// Le web a `ouvrir_fichier_web.dart`, le téléphone `ouvrir_fichier_io.dart` ;
/// ce stub ne sert qu'à une cible sans navigateur ni système de fichiers.
void ouvrirDansNavigateur(Uint8List octets, String nom, String mime) {}
