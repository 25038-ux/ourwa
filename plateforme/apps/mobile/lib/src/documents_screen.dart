import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'i18n.dart';
import 'ouvrir_fichier.dart';
import 'tabs/_shared.dart';
import 'telechargements.dart';
import 'theme.dart';

/// LES DOCUMENTS SIGNÉS — ADR-0080, demande de Jinan du 04/10/2026.
///
/// Par enfant, une ligne par pièce : l'inscription, la photocopie, chaque
/// service souscrit. Une pièce est « Disponible » (le document signé que
/// l'école a déposé : l'ouvrir, le télécharger) ou « En attente ».
///
/// ⚠ LECTURE SEULE, ET RIEN NE LE CACHE : aucun bouton n'écrit, et l'API n'a
/// d'ailleurs aucune route d'écriture pour une famille. Seule l'école dépose,
/// remplace et supprime.
///
/// ⚠ HORS LIGNE : la dernière liste reçue est gardée sur le téléphone et
/// montrée tout de suite (une ligne comptée à Nouakchott ne doit pas
/// attendre un tour réseau pour revoir ce qu'elle a déjà vu) ; le réseau la
/// rafraîchit derrière.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key, required this.api, required this.lang});

  final ApiClient api;
  final String lang;

  static const cleCache = 'cache_documents_v1';

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  Map<String, dynamic>? _donnees;
  bool _charge = false;
  bool _horsLigne = false;

  String get _lang => widget.lang;

  @override
  void initState() {
    super.initState();
    _demarrer();
  }

  Future<void> _demarrer() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final brut = prefs.getString(DocumentsScreen.cleCache);
      if (brut != null && mounted && _donnees == null) {
        setState(() => _donnees = jsonDecode(brut) as Map<String, dynamic>);
      }
    } catch (_) {
      // Un cache illisible n'empêche rien : le réseau répondra.
    }
    await _recharger();
  }

  Future<void> _recharger() async {
    try {
      final r = await widget.api.get('/parent/documents');
      if (!mounted) return;
      setState(() {
        _donnees = r;
        _charge = true;
        _horsLigne = false;
      });
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(DocumentsScreen.cleCache, jsonEncode(r));
      } catch (_) {}
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _charge = true;
        _horsLigne = true;
      });
    }
  }

  void _ouvrir(Map<String, dynamic> doc) {
    final id = doc['id'] as String;
    final nom = doc['nom'] as String? ?? 'document';
    final mime = doc['mime'] as String? ?? 'application/pdf';
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => VisionneuseFichier(nom: nom, mime: mime, octets: widget.api.bytes('/parent/documents/$id')),
      ),
    );
  }

  Future<void> _telecharger(Map<String, dynamic> doc) async {
    final messager = ScaffoldMessenger.of(context);
    final nom = doc['nom'] as String? ?? 'document';
    final mime = doc['mime'] as String? ?? 'application/pdf';
    try {
      final Uint8List octets = await widget.api.bytes('/parent/documents/${doc['id']}');
      if (kIsWeb) {
        ouvrirDansNavigateur(octets, nom, mime);
        return;
      }
      final r = await Telechargements.enregistrerEtOuvrir(nom, octets, mime);
      if (r == 'telechargements') messager.showSnackBar(SnackBar(content: Text(t('document_enregistre', _lang))));
      if (r == 'echec') messager.showSnackBar(SnackBar(content: Text(t('document_erreur', _lang))));
    } catch (_) {
      messager.showSnackBar(SnackBar(content: Text(t('document_erreur', _lang))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _donnees;
    if (d == null && !_charge) return const Squelette(lignes: 4, hauteur: 120);
    final enfants = ((d?['enfants'] as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
    final annee = (d?['annee'] as Map<String, dynamic>?)?['label'] as String?;

    return RefreshIndicator(
      color: Ocean.c600,
      onRefresh: _recharger,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
        children: [
          _EnTete(lang: _lang, annee: annee),
          if (_horsLigne && d != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Bandeau(icone: Icons.cloud_off_rounded, texte: t('hors_ligne_copie', _lang)),
            ),
          if (enfants.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: EtatVide(
                icone: Icons.folder_open_rounded,
                titre: t('documents_vide', _lang),
                texte: _horsLigne ? t('document_erreur', _lang) : t('documents_vide_texte', _lang),
              ),
            ),
          for (final (i, e) in enfants.indexed)
            Apparition(
              rang: i,
              child: _CarteEnfant(
                enfant: e,
                lang: _lang,
                onOuvrir: _ouvrir,
                onTelecharger: _telecharger,
              ),
            ),
        ],
      ),
    );
  }
}

class _EnTete extends StatelessWidget {
  const _EnTete({required this.lang, required this.annee});
  final String lang;
  final String? annee;

  @override
  Widget build(BuildContext context) {
    final th = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: Ocean.entete,
        borderRadius: BorderRadius.circular(Ocean.rLg),
        boxShadow: Ocean.shadow,
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: .16), borderRadius: BorderRadius.circular(Ocean.rMd)),
            child: const Icon(Icons.verified_outlined, color: Ocean.or, size: 26),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('documents', lang), style: th.headlineSmall?.copyWith(color: Colors.white)),
                const SizedBox(height: 2),
                Text(
                  // ⚠ L'année et le compte isolés de gauche à droite (U+2066…U+2069) :
                  // en arabe, « 2025-2026 » se lisait « 2026-2025 » et « 3 / 4 », « 4 / 3 ».
                  annee == null ? t('documents_sous_titre', lang) : '${t('documents_sous_titre', lang)} · \u2066$annee\u2069',
                  style: th.bodySmall?.copyWith(color: Colors.white.withValues(alpha: .85)),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.lock_outline_rounded, size: 14, color: Colors.white.withValues(alpha: .8)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        t('documents_lecture_seule', lang),
                        style: th.bodySmall?.copyWith(color: Colors.white.withValues(alpha: .8), fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CarteEnfant extends StatelessWidget {
  const _CarteEnfant({required this.enfant, required this.lang, required this.onOuvrir, required this.onTelecharger});

  final Map<String, dynamic> enfant;
  final String lang;
  final void Function(Map<String, dynamic>) onOuvrir;
  final void Function(Map<String, dynamic>) onTelecharger;

  @override
  Widget build(BuildContext context) {
    final th = Theme.of(context).textTheme;
    final nom = '${enfant['prenom'] ?? ''} ${enfant['nom'] ?? ''}'.trim();
    final classe = enfant['classe'] as String?;
    final pieces = ((enfant['pieces'] as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
    final prets = pieces.where((p) => p['document'] != null).length;

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Carte(
        padding: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
              child: Row(
                children: [
                  AvatarInitiales(nom: nom, taille: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(nom, style: th.titleMedium),
                        if (classe != null) Text(classe, style: th.bodySmall),
                      ],
                    ),
                  ),
                  Pastille(
                    texte: '\u2066$prets / ${pieces.length}\u2069',
                    couleur: prets == pieces.length && pieces.isNotEmpty ? Ocean.success : Ocean.c600,
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            for (final p in pieces)
              _LignePiece(piece: p, lang: lang, onOuvrir: onOuvrir, onTelecharger: onTelecharger),
          ],
        ),
      ),
    );
  }
}

class _LignePiece extends StatelessWidget {
  const _LignePiece({required this.piece, required this.lang, required this.onOuvrir, required this.onTelecharger});

  final Map<String, dynamic> piece;
  final String lang;
  final void Function(Map<String, dynamic>) onOuvrir;
  final void Function(Map<String, dynamic>) onTelecharger;

  @override
  Widget build(BuildContext context) {
    final th = Theme.of(context).textTheme;
    final doc = piece['document'] as Map<String, dynamic>?;
    final libelle = piece['libelle'] as String? ?? '';
    final pret = doc != null;
    final date = pret ? _jour(doc['deposeLe'] as String?) : null;

    return InkWell(
      onTap: pret ? () => onOuvrir(doc) : null,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 8, 12),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: pret ? Ocean.c100 : Ocean.sable,
                borderRadius: BorderRadius.circular(Ocean.rSm),
              ),
              child: Icon(
                pret ? iconeFichier(doc['mime'] as String? ?? '') : Icons.hourglass_empty_rounded,
                color: pret ? Ocean.c700 : Ocean.orFonce,
                size: 21,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(libelle, style: th.titleSmall?.copyWith(color: Ocean.ink900)),
                  const SizedBox(height: 2),
                  Text(
                    pret
                        ? '${t('document_disponible', lang)} · ${t('document_depose_le', lang).replaceAll('{date}', date ?? '')}'
                        : t('document_attente_texte', lang),
                    style: th.bodySmall?.copyWith(color: pret ? Ocean.success : Ocean.ink500),
                  ),
                ],
              ),
            ),
            if (pret) ...[
              IconButton(
                tooltip: t('document_telecharger', lang),
                onPressed: () => onTelecharger(doc),
                icon: const Icon(Icons.download_rounded, color: Ocean.c700),
              ),
              IconButton(
                tooltip: t('document_ouvrir', lang),
                onPressed: () => onOuvrir(doc),
                icon: const Icon(Icons.visibility_outlined, color: Ocean.c700),
              ),
            ] else
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 8),
                child: Pastille(texte: t('document_en_attente', lang), couleur: Ocean.orFonce),
              ),
          ],
        ),
      ),
    );
  }

  static String? _jour(String? iso) {
    final d = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    if (d == null) return null;
    String p(int n) => n.toString().padLeft(2, '0');
    return '${p(d.day)}/${p(d.month)}/${d.year}';
  }
}
