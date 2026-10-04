import 'package:flutter/material.dart';
import 'dart:typed_data';
import '../api.dart';
import '../i18n.dart';
import '../theme.dart';
import '../ouvrir_fichier.dart';

/// The child picker every tab needs.
///
/// A family with three children asks each question about one of them, so the
/// choice belongs at the top of the tab rather than in a settings page. With one
/// child it disappears — a chooser with a single option is noise.
class ChildPicker extends StatelessWidget {
  const ChildPicker({
    super.key,
    required this.children,
    required this.selected,
    required this.onChanged,
  });

  final List<Child> children;
  final Child? selected;
  final ValueChanged<Child> onChanged;

  @override
  Widget build(BuildContext context) {
    if (children.length < 2) return const SizedBox.shrink();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          for (final c in children)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 8),
              child: ChoiceChip(
                label: Text(c.firstName),
                selected: c.id == selected?.id,
                onSelected: (_) => onChanged(c),
                selectedColor: Ocean.c100,
                shape: StadiumBorder(
                  side: BorderSide(
                    color: c.id == selected?.id ? Ocean.c400 : Ocean.glassBorder,
                  ),
                ),
                backgroundColor: Ocean.glass,
              ),
            ),
        ],
      ),
    );
  }
}

/// Nothing to show, said in the reader's language.
///
/// A blank screen is indistinguishable from a broken one, and a parent who sees
/// one assumes the school has lost something.
class TabEmpty extends StatelessWidget {
  const TabEmpty({super.key, required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) => EtatVide(icone: icon, titre: message);
}

/// A tab that loads one child's data.
class ChildTabScaffold extends StatefulWidget {
  const ChildTabScaffold({
    super.key,
    required this.api,
    required this.lang,
    required this.builder,
  });

  final ApiClient api;
  final String lang;
  final Widget Function(BuildContext context, Child child, String lang) builder;

  @override
  State<ChildTabScaffold> createState() => _ChildTabScaffoldState();
}

class _ChildTabScaffoldState extends State<ChildTabScaffold> {
  late Future<List<Child>> _children;
  Child? _selected;

  @override
  void initState() {
    super.initState();
    _children = _load();
  }

  Future<List<Child>> _load() async {
    final json = await widget.api.get('/parent/children');
    return (json['children'] as List<dynamic>)
        .map((e) => Child.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Child>>(
      future: _children,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Squelette(lignes: 5, hauteur: 72);
        }
        // ⚠ Une panne n'est pas « aucun enfant » : hors ligne, la famille
        // lisait qu'aucun enfant n'était rattaché à son compte.
        if (snapshot.hasError) {
          return EtatVide(
            icone: Icons.cloud_off_rounded,
            titre: widget.lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
            texte: t('erreur_reseau', widget.lang),
            action: FilledButton.icon(
              onPressed: () => setState(() => _children = _load()),
              icon: const Icon(Icons.refresh),
              label: Text(widget.lang == 'ar' ? 'إعادة المحاولة' : 'Réessayer'),
            ),
          );
        }
        final children = snapshot.data ?? const <Child>[];
        if (children.isEmpty) {
          return TabEmpty(
            icon: Icons.child_care_outlined,
            message: t('aucun_enfant', widget.lang),
          );
        }
        _selected ??= children.first;

        return Column(
          children: [
            ChildPicker(
              children: children,
              selected: _selected,
              onChanged: (c) => setState(() => _selected = c),
            ),
            Expanded(child: widget.builder(context, _selected!, widget.lang)),
          ],
        );
      },
    );
  }
}

/// The heading every parent feed opens with — its `📊 Résultats` / `📅 Absences`
/// pattern: an emoji, the name in the display serif, then one line saying what
/// the list contains.
class FeedHeader extends StatelessWidget {
  const FeedHeader({
    super.key,
    required this.emoji,
    required this.title,
    required this.subtitle,
  });

  final String emoji;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$emoji $title',
            style: const TextStyle(
              fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'],
              fontSize: 26,
              fontWeight: FontWeight.w700,
              color: Ocean.ink900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(fontSize: 14.5, height: 1.4, color: Ocean.ink500),
          ),
        ],
      ),
    );
  }
}

/// Nothing to show — and it says which kind of nothing.
class EmptyFeed extends StatelessWidget {
  const EmptyFeed({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return EtatVide(icone: Icons.inbox_outlined, titre: label);
  }
}

/// Its `date('d/m/Y')`. An ISO date on a parent's phone is one they decode;
/// 15/03/2026 is one they read.
String jourMoisAn(String raw) {
  final d = DateTime.tryParse(raw);
  if (d == null) return raw;
  String p(int n) => n.toString().padLeft(2, '0');
  return '${p(d.day)}/${p(d.month)}/${d.year}';
}

/// LA GRILLE DE PIÈCES JOINTES — le `.attachment-grid` de `exercices.php`.
///
/// ⚠ ELLE N'EXISTAIT PAS. Sa page rend, sous chaque exercice, une vignette
/// cliquable pour une image (avec sa visionneuse) et une carte nommée pour un
/// PDF. Rien de tout cela n'arrivait jusqu'à la famille : le professeur pouvait
/// joindre le sujet — quand le champ a existé — et le parent ne le voyait
/// jamais.
///
/// ⚠ ET LES OCTETS PASSENT PAR LE CLIENT AUTHENTIFIÉ. `/attachments/:id` vérifie
/// que le demandeur est bien le parent d'un inscrit du groupe ; un `<img src>`
/// n'enverrait pas le jeton et recevrait un 401. On les lit donc nous-mêmes.
class GrilleFichiers extends StatelessWidget {
  const GrilleFichiers({super.key, required this.api, required this.fichiers});

  final ApiClient api;
  final List<Map<String, dynamic>> fichiers;

  static String taille(int octets) {
    if (octets < 1024) return '$octets o';
    if (octets < 1024 * 1024) return '${(octets / 1024).toStringAsFixed(1)} Ko';
    return '${(octets / 1024 / 1024).toStringAsFixed(1)} Mo';
  }

  @override
  Widget build(BuildContext context) {
    if (fichiers.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final f in fichiers)
            _CarteFichier(
              api: api,
              id: f['id'] as String,
              nom: f['name'] as String? ?? '',
              mime: f['mime'] as String? ?? '',
              octets: (f['bytes'] as num?)?.toInt() ?? 0,
            ),
        ],
      ),
    );
  }
}

class _CarteFichier extends StatefulWidget {
  const _CarteFichier({
    required this.api,
    required this.id,
    required this.nom,
    required this.mime,
    required this.octets,
  });

  final ApiClient api;
  final String id;
  final String nom;
  final String mime;
  final int octets;

  @override
  State<_CarteFichier> createState() => _CarteFichierState();
}

class _CarteFichierState extends State<_CarteFichier> {
  Future<Uint8List>? _octets;

  bool get _estImage => widget.mime.startsWith('image/');

  @override
  void initState() {
    super.initState();
    // Une image se charge tout de suite : c'est la vignette. Un PDF attend
    // qu'on le demande — inutile de faire descendre cinq mégaoctets pour
    // afficher un nom de fichier.
    if (_estImage) _octets = widget.api.bytes('/attachments/${widget.id}');
  }

  void _ouvrir() {
    final futur = _octets ??= widget.api.bytes('/attachments/${widget.id}');
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => VisionneuseFichier(
          nom: widget.nom,
          mime: widget.mime,
          octets: futur,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: _ouvrir,
      borderRadius: BorderRadius.circular(Ocean.rSm),
      child: Container(
        width: 108,
        height: 108,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: Ocean.c200),
          borderRadius: BorderRadius.circular(Ocean.rSm),
        ),
        child: _estImage
            ? FutureBuilder<Uint8List>(
                future: _octets,
                builder: (context, snap) => snap.hasData
                    ? Image.memory(snap.data!, fit: BoxFit.cover, width: 108, height: 108)
                    : const Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
              )
            : Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(iconeFichier(widget.mime), size: 30, color: Ocean.c600),
                    const SizedBox(height: 6),
                    Text(
                      widget.nom,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      GrilleFichiers.taille(widget.octets),
                      style: const TextStyle(fontSize: 10, color: Ocean.ink300),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// L'icône d'un fichier selon son type : PDF, image, ou document de bureau
/// (Word, Excel, PowerPoint — admis dans les exercices depuis le 04/10/2026).
IconData iconeFichier(String mime) {
  if (mime.startsWith('image/')) return Icons.image_outlined;
  if (mime == 'application/pdf') return Icons.picture_as_pdf_outlined;
  if (mime.contains('sheet') || mime.contains('excel')) return Icons.table_chart_outlined;
  if (mime.contains('presentation') || mime.contains('powerpoint')) return Icons.slideshow_outlined;
  return Icons.description_outlined;
}

/// Sa visionneuse — le `data-lightbox` de sa grille, en plein écran. Une
/// image s'affiche ici ; un PDF ou un document Word est remis à l'application
/// du téléphone qui sait l'ouvrir, AVEC SON VRAI TYPE (« application/pdf »
/// codé en dur envoyait une fiche Word au lecteur PDF, qui la refusait).
class VisionneuseFichier extends StatelessWidget {
  const VisionneuseFichier({
    super.key,
    required this.nom,
    required this.mime,
    required this.octets,
  });

  final String nom;
  final String mime;
  final Future<Uint8List> octets;

  bool get _estImage => mime.startsWith('image/');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B1F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0B1F1A),
        foregroundColor: Colors.white,
        title: Text(nom, style: const TextStyle(fontSize: 15)),
        actions: [
          FutureBuilder<Uint8List>(
            future: octets,
            builder: (context, snap) => snap.hasData
                ? IconButton(
                    tooltip: 'Ouvrir / partager',
                    icon: const Icon(Icons.ios_share_rounded),
                    onPressed: () => ouvrirDansNavigateur(snap.data!, nom, mime),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
      body: FutureBuilder<Uint8List>(
        future: octets,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(color: Colors.white70));
          }
          if (snap.hasError || !snap.hasData) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Ce fichier n’a pas pu être ouvert.',
                  style: TextStyle(color: Colors.white),
                ),
              ),
            );
          }
          if (_estImage) {
            return InteractiveViewer(
              maxScale: 5,
              child: Center(child: Image.memory(snap.data!)),
            );
          }
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(iconeFichier(mime), size: 64, color: Colors.white70),
                  const SizedBox(height: 16),
                  Text(
                    nom,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: () => ouvrirDansNavigateur(snap.data!, nom, mime),
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Ouvrir'),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Le nom d'un enfant dans une liste de famille, suivi de son école quand la
/// famille a des enfants dans plusieurs branches (une application pour toutes
/// les branches — la ligne dit alors d'où elle vient).
String nomAvecEcole(Map<String, dynamic> row, String nom, {required bool plusieursEcoles, required bool arabe}) {
  final school = row['school'];
  if (!plusieursEcoles || school is! Map<String, dynamic>) return nom;
  final ar = school['nameAr'] as String?;
  final libelle = arabe && ar != null && ar.isNotEmpty ? ar : (school['name'] as String? ?? '');
  return libelle.isEmpty ? nom : '$nom · $libelle';
}

/// UNE REQUÊTE, UNE FOIS. Un `FutureBuilder(future: api.get(…))` écrit dans
/// `build` relance la requête à chaque reconstruction du parent (chaque
/// sondage de la coquille) : la liste repassait par la trame toutes les
/// quinze secondes. Ici la future vit dans l'état et ne change qu'avec le chemin.
class ChargeurJson extends StatefulWidget {
  const ChargeurJson({super.key, required this.api, required this.chemin, required this.builder});

  final ApiClient api;
  final String chemin;
  final Widget Function(BuildContext context, AsyncSnapshot<Map<String, dynamic>> snapshot, Future<void> Function() recharger) builder;

  @override
  State<ChargeurJson> createState() => _ChargeurJsonState();
}

class _ChargeurJsonState extends State<ChargeurJson> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.get(widget.chemin);
  }

  @override
  void didUpdateWidget(ChargeurJson old) {
    super.didUpdateWidget(old);
    if (old.chemin != widget.chemin) _future = widget.api.get(widget.chemin);
  }

  Future<void> _recharger() async {
    setState(() => _future = widget.api.get(widget.chemin));
    await _future.catchError((_) => <String, dynamic>{});
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) => widget.builder(context, snapshot, _recharger),
      );
}
