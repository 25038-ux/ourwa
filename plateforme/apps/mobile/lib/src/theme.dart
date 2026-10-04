import 'package:flutter/material.dart';

/// LE DESIGN DE L'APPLICATION DES FAMILLES — « Jardin » (04/10/2026).
///
/// Il remplace « Glass Ocean » (le verre dépoli sur rampe cyan d'El Ourwa) à
/// la demande du propriétaire de Jinan : « Change the ui of the app and make
/// it better (not the same ui) ». Jinan — جنان — ce sont les jardins : un vert
/// émeraude profond, un or chaud pour ce qui demande l'attention, un ivoire
/// pour le sol, des cartes PLEINES (le verre se lisait mal au soleil, sur un
/// écran bon marché).
///
/// ⚠ LE NOM DE LA CLASSE EST RESTÉ `Ocean`, et ses noms de teintes aussi
/// (`c50` … `c950`, `ink*`) : cent quarante écrans et widgets les lisent. Les
/// VALEURS ont changé — c'est ce qui fait changer toute l'application d'un
/// coup, sans qu'un écran oublié reste bleu.
class Ocean {
  const Ocean._();

  // ── La rampe émeraude ─────────────────────────────────────────────────────
  static const c50 = Color(0xFFEEF8F3);
  static const c100 = Color(0xFFD5EFE3);
  static const c200 = Color(0xFFABDDC8);
  static const c300 = Color(0xFF79C6A8);
  static const c400 = Color(0xFF45A884);

  /// L'accent principal.
  static const c500 = Color(0xFF1F8A65);
  static const c600 = Color(0xFF157252);
  static const c700 = Color(0xFF0F5C43);
  static const c800 = Color(0xFF0B4734);
  static const c900 = Color(0xFF083527);
  static const c950 = Color(0xFF04241A);

  // ── L'or, et le sable ─────────────────────────────────────────────────────
  static const or = Color(0xFFE0B04F);
  static const orFonce = Color(0xFFA8741A);
  static const sable = Color(0xFFF6EBD3);

  // ── L'encre (un noir vert, jamais un gris froid) ──────────────────────────
  static const ink900 = Color(0xFF12261E);
  static const ink700 = Color(0xFF2D4339);
  static const ink500 = Color(0xFF5E7268);
  static const ink300 = Color(0xFF9AAAA2);

  // ── Sémantique ────────────────────────────────────────────────────────────
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const info = c500;

  // ── Surfaces : pleines, posées sur l'ivoire ───────────────────────────────
  static const ivoire = Color(0xFFFBF8F1);
  static const ligne = Color(0xFFE9E3D5);
  static const glass = Colors.white;
  static const glassStrong = Colors.white;
  static const glassDeep = Color(0xB3FFFFFF);
  static const glassBorder = ligne;

  /// Des ombres teintées de vert, courtes : une carte se pose, elle ne flotte pas.
  static const List<BoxShadow> shadow = [
    BoxShadow(color: Color(0x14083527), blurRadius: 18, offset: Offset(0, 6)),
    BoxShadow(color: Color(0x0A083527), blurRadius: 4, offset: Offset(0, 1)),
  ];

  static const List<BoxShadow> shadowLg = [
    BoxShadow(color: Color(0x1F083527), blurRadius: 40, offset: Offset(0, 16)),
    BoxShadow(color: Color(0x0F083527), blurRadius: 12, offset: Offset(0, 4)),
  ];

  // ── Rayons ────────────────────────────────────────────────────────────────
  static const rSm = 12.0;
  static const rMd = 18.0;
  static const rLg = 24.0;
  static const rXl = 32.0;
  static const rFull = 999.0;

  static const ease = Cubic(0.22, 1, 0.36, 1);
  static const fast = Duration(milliseconds: 180);
  static const med = Duration(milliseconds: 320);
  static const slow = Duration(milliseconds: 520);

  /// Le sol des pages : l'ivoire, à peine plus chaud en bas.
  static const Gradient backdrop = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [ivoire, Color(0xFFF7F2E7)],
  );

  /// L'en-tête : l'émeraude, du profond au clair.
  static const Gradient entete = LinearGradient(
    begin: AlignmentDirectional.topStart,
    end: AlignmentDirectional.bottomEnd,
    colors: [c800, c600, c500],
    stops: [0, .55, 1],
  );
}

/// The app's theme.
///
/// Plus Jakarta Sans for the body and Fraunces for display, as its stylesheet
/// imports them. They are declared by family name so a device that has them uses
/// them and one that does not falls back rather than failing — the app must open
/// on a cheap phone with no network.
ThemeData oceanTheme({required bool arabic}) {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: Ocean.c500,
      primary: Ocean.c600,
      secondary: Ocean.orFonce,
      tertiary: Ocean.or,
      surface: Colors.white,
      error: Ocean.danger,
    ),
    scaffoldBackgroundColor: Ocean.ivoire,
  );

  // Une échelle typographique posée une fois (tailles, graisses, interlignes),
  // pour que chaque écran parle la même langue — et reste lisible quand le
  // téléphone agrandit le texte (main.dart borne l'échelle à 0,9–1,25).
  final texte = base.textTheme
      .apply(
        fontFamily: 'Plus Jakarta Sans',
        // ⚠ Le repli qui rend l'arabe sans réseau : voir `fonts:` dans pubspec.
        // Sans lui, le web attend un téléchargement depuis Google pour chaque
        // glyphe arabe — et affiche des carrés en attendant, ou pour toujours.
        fontFamilyFallback: const ['Noto Sans Arabic'],
        bodyColor: Ocean.ink900,
        displayColor: Ocean.ink900,
      )
      .copyWith(
        headlineMedium: const TextStyle(fontFamily: 'Fraunces', fontSize: 26, fontWeight: FontWeight.w700, height: 1.15, color: Ocean.ink900),
        headlineSmall: const TextStyle(fontFamily: 'Fraunces', fontSize: 21, fontWeight: FontWeight.w700, height: 1.2, color: Ocean.ink900),
        titleLarge: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.25, color: Ocean.ink900),
        titleMedium: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, height: 1.3, color: Ocean.ink900),
        titleSmall: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, height: 1.3, color: Ocean.ink700),
        bodyLarge: const TextStyle(fontSize: 15.5, height: 1.45, color: Ocean.ink900),
        bodyMedium: const TextStyle(fontSize: 14, height: 1.45, color: Ocean.ink700),
        bodySmall: const TextStyle(fontSize: 12.5, height: 1.4, color: Ocean.ink500),
        labelLarge: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, letterSpacing: .1),
        labelMedium: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: .3, color: Ocean.ink500),
      )
      // ⚠ ET LE REPLI ARABE UNE SECONDE FOIS : les styles posés par `copyWith`
      // ci-dessus sont NEUFS et ne l'héritaient pas — sur le web, chaque titre
      // et chaque ligne de texte arabe s'affichait en carrés (le téléphone, lui,
      // trouve l'arabe dans ses polices système). Vu sur l'écran Documents, 04/10/2026.
      .apply(fontFamilyFallback: const ['Noto Sans Arabic']);

  return base.copyWith(
    textTheme: texte,
    visualDensity: VisualDensity.standard,
    splashFactory: InkSparkle.splashFactory,
    listTileTheme: const ListTileThemeData(
      iconColor: Ocean.c600,
      // ⚠ Le repli arabe ici aussi : sans lui, « العربية » s'affichait en carrés.
      titleTextStyle: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Ocean.ink900, fontFamily: 'Plus Jakarta Sans', fontFamilyFallback: ['Noto Sans Arabic']),
      subtitleTextStyle: TextStyle(fontSize: 12.5, color: Ocean.ink500, fontFamily: 'Plus Jakarta Sans', fontFamilyFallback: ['Noto Sans Arabic']),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Ocean.c50,
      side: const BorderSide(color: Ocean.c100),
      labelStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Ocean.ink700),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rFull)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Ocean.ink900,
      contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rSm)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rLg)),
      titleTextStyle: const TextStyle(fontFamily: 'Fraunces', fontSize: 20, fontWeight: FontWeight.w700, color: Ocean.ink900),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Ocean.rLg))),
      showDragHandle: true,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Ocean.c500),
    tabBarTheme: const TabBarThemeData(
      labelColor: Ocean.c700,
      unselectedLabelColor: Ocean.ink500,
      indicatorColor: Ocean.c500,
      labelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
      unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w500, fontSize: 13.5),
      dividerColor: Colors.transparent,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      foregroundColor: Ocean.ink900,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Ocean.rMd),
        side: const BorderSide(color: Ocean.ligne),
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Ocean.c600,
        foregroundColor: Colors.white,
        // Des boutons francs, aux coins adoucis — plus des pilules.
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Ocean.rSm),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.glassBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.ligne),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.c600, width: 2),
      ),
      labelStyle: const TextStyle(color: Ocean.ink500),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Ocean.c100,
      indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ocean.rSm)),
      elevation: 0,
      height: 66,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 11.5,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          color: s.contains(WidgetState.selected) ? Ocean.c700 : Ocean.ink500,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(color: s.contains(WidgetState.selected) ? Ocean.c700 : Ocean.ink500, size: 24),
      ),
    ),
    dividerTheme: const DividerThemeData(color: Ocean.ligne, thickness: 1),
    drawerTheme: const DrawerThemeData(
      backgroundColor: Ocean.ivoire,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadiusDirectional.only(topEnd: Radius.circular(Ocean.rLg), bottomEnd: Radius.circular(Ocean.rLg)),
      ),
    ),
  );
}

/// Une carte pleine (« Jardin ») — l'ancien panneau de verre garde son nom.
class GlassCard extends StatelessWidget {
  const GlassCard({super.key, required this.child, this.padding, this.strong = true});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final bool strong;

  @override
  Widget build(BuildContext context) => Carte(padding: padding, child: child);
}

/// LA CARTE : blanche, bordée d'un trait chaud, une ombre courte.
class Carte extends StatelessWidget {
  const Carte({super.key, required this.child, this.padding, this.couleur = Colors.white});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color couleur;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? const EdgeInsets.all(16),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: couleur,
        borderRadius: BorderRadius.circular(Ocean.rMd),
        border: Border.all(color: Ocean.ligne),
        boxShadow: Ocean.shadow,
      ),
      child: child,
    );
  }
}

/// Une pastille : un mot court sur un fond teinté de sa couleur.
class Pastille extends StatelessWidget {
  const Pastille({super.key, required this.texte, this.couleur = Ocean.c600});
  final String texte;
  final Color couleur;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: couleur.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(Ocean.rFull),
        ),
        child: Text(texte, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: couleur)),
      );
}

/// Un bandeau d'information dans la page (hors ligne, avertissement).
class Bandeau extends StatelessWidget {
  const Bandeau({super.key, required this.icone, required this.texte, this.couleur = Ocean.orFonce});
  final IconData icone;
  final String texte;
  final Color couleur;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Ocean.sable,
          borderRadius: BorderRadius.circular(Ocean.rSm),
          border: Border.all(color: Ocean.or.withValues(alpha: .5)),
        ),
        child: Row(
          children: [
            Icon(icone, size: 18, color: couleur),
            const SizedBox(width: 10),
            Expanded(child: Text(texte, style: TextStyle(fontSize: 12.5, color: couleur, fontWeight: FontWeight.w600))),
          ],
        ),
      );
}

/// LE CONTENU RESTE LISIBLE SUR TOUTES LES TAILLES : sur une tablette ou un
/// grand téléphone en paysage, une colonne de 640 px centrée ; sur un petit
/// téléphone, toute la largeur. À poser autour de chaque liste d'écran.
class ContenuLarge extends StatelessWidget {
  const ContenuLarge({super.key, required this.child, this.maxWidth = 640});
  final Widget child;
  final double maxWidth;
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child),
      );
}

/// Large écran ? (deux colonnes de cartes à partir de 600 px de large.)
bool ecranLarge(BuildContext context) => MediaQuery.sizeOf(context).width >= 600;

/// L'ÉTAT VIDE — une icône dans un disque pâle, un titre, une phrase calme.
/// La même voix partout : « Aucun exercice pour l'instant » n'est pas une erreur.
class EtatVide extends StatelessWidget {
  const EtatVide({super.key, required this.icone, required this.titre, this.texte, this.action});
  final IconData icone;
  final String titre;
  final String? texte;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final th = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(32, 40, 32, 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: Ocean.sable,
                shape: BoxShape.circle,
                border: Border.all(color: Ocean.or.withValues(alpha: .45), width: 1.5),
              ),
              child: Icon(icone, size: 34, color: Ocean.orFonce),
            ),
            const SizedBox(height: 16),
            Text(titre, textAlign: TextAlign.center, style: th.titleLarge),
            if (texte != null) ...[
              const SizedBox(height: 6),
              Text(texte!, textAlign: TextAlign.center, style: th.bodyMedium),
            ],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}

/// LA TRAME DE CHARGEMENT — des blocs pâles qui respirent, à la place d'une
/// roue : l'écran a déjà sa forme pendant que le serveur répond.
class Squelette extends StatefulWidget {
  const Squelette({super.key, this.lignes = 3, this.hauteur = 84});
  final int lignes;
  final double hauteur;
  @override
  State<Squelette> createState() => _SqueletteState();
}

class _SqueletteState extends State<Squelette> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: widget.lignes,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) => FadeTransition(
          opacity: Tween(begin: 0.45, end: 0.9).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut)),
          child: Container(
            height: widget.hauteur,
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(Ocean.rMd), border: Border.all(color: Ocean.ligne)),
          ),
        ),
      );
}

/// Une entrée en douceur (fondu + léger glissement), décalée par rang dans une liste.
class Apparition extends StatelessWidget {
  const Apparition({super.key, required this.child, this.rang = 0});
  final Widget child;
  final int rang;
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Duration(milliseconds: 260 + (rang.clamp(0, 8) * 45)),
        curve: Ocean.ease,
        builder: (_, v, child) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, (1 - v) * 10), child: child)),
        child: child,
      );
}

/// Les initiales d'un enfant dans un disque teinté — stable par nom.
class AvatarInitiales extends StatelessWidget {
  const AvatarInitiales({super.key, required this.nom, this.taille = 44});
  final String nom;
  final double taille;
  @override
  Widget build(BuildContext context) {
    final parts = nom.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    final initiales = parts.take(2).map((p) => p.characters.first.toUpperCase()).join();
    final teintes = [Ocean.c600, Ocean.c800, const Color(0xFFA8741A), const Color(0xFF9D4A6B), const Color(0xFF2F6B8A), const Color(0xFF6B5B95)];
    final couleur = teintes[nom.codeUnits.fold<int>(0, (a, b) => a + b) % teintes.length];
    return Container(
      width: taille,
      height: taille,
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [couleur.withValues(alpha: .85), couleur], begin: Alignment.topLeft, end: Alignment.bottomRight),
        shape: BoxShape.circle,
        boxShadow: [BoxShadow(color: couleur.withValues(alpha: .3), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      alignment: Alignment.center,
      child: Text(initiales.isEmpty ? '•' : initiales, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: taille * .38)),
    );
  }
}

/// Un titre de section — petites majuscules espacées, la couleur d'encre pâle.
class TitreSection extends StatelessWidget {
  const TitreSection(this.texte, {super.key, this.action});
  final String texte;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
        child: Row(
          children: [
            Expanded(child: Text(texte.toUpperCase(), style: Theme.of(context).textTheme.labelMedium)),
            if (action != null) action!,
          ],
        ),
      );
}
