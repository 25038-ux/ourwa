import 'package:flutter/material.dart';

/// El Ourwa's parent design system — "Glass Ocean".
///
/// Its own name, from the top of `assets/css/parent.css`: glassmorphism over an
/// ocean-blue ramp, mobile-first. It is deliberately nothing like the direction
/// screens, which are cream and terracotta ("Organic") — the two audiences never
/// see each other's, and a parent should not feel they have wandered into the
/// office.
///
/// The values are its values. Only the ones the app actually renders are carried
/// over; the rest of its 1 325 lines are web layout that Flutter expresses
/// differently.
class Ocean {
  const Ocean._();

  // ── The ramp ──────────────────────────────────────────────────────────────
  static const c50 = Color(0xFFECFEFF);
  static const c100 = Color(0xFFCFFAFE);
  static const c200 = Color(0xFFA5F3FC);
  static const c300 = Color(0xFF67E8F9);
  static const c400 = Color(0xFF22D3EE);

  /// The principal accent, as its own comment marks it.
  static const c500 = Color(0xFF06B6D4);
  static const c600 = Color(0xFF0891B2);
  static const c700 = Color(0xFF0E7490);
  static const c800 = Color(0xFF155E75);
  static const c900 = Color(0xFF164E63);
  static const c950 = Color(0xFF0A2540);

  // ── Ink ───────────────────────────────────────────────────────────────────
  static const ink900 = Color(0xFF0A2540);
  static const ink700 = Color(0xFF1E3A52);
  static const ink500 = Color(0xFF506680);
  static const ink300 = Color(0xFF94A8BE);

  // ── Semantic ──────────────────────────────────────────────────────────────
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);
  static const info = c500;

  // ── Glass surfaces ────────────────────────────────────────────────────────
  static const glass = Color(0x8CFFFFFF); // rgba(255,255,255,.55)
  static const glassStrong = Color(0xC7FFFFFF); // .78
  static const glassDeep = Color(0x52FFFFFF); // .32
  static const glassBorder = Color(0x99FFFFFF); // .60

  /// Its `--glass-shadow`: tinted with the ocean rather than grey, because a
  /// neutral shadow over these blues reads as dirt.
  static const List<BoxShadow> shadow = [
    BoxShadow(color: Color(0x1F0891B2), blurRadius: 32, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x0A0A2540), blurRadius: 8, offset: Offset(0, 2)),
  ];

  static const List<BoxShadow> shadowLg = [
    BoxShadow(color: Color(0x2E0891B2), blurRadius: 64, offset: Offset(0, 24)),
    BoxShadow(color: Color(0x0F0A2540), blurRadius: 24, offset: Offset(0, 8)),
  ];

  // ── Radii ─────────────────────────────────────────────────────────────────
  static const rSm = 10.0;
  static const rMd = 16.0;
  static const rLg = 24.0;
  static const rXl = 32.0;
  static const rFull = 999.0;

  /// Its `--ease`, and the three durations it names.
  static const ease = Cubic(0.22, 1, 0.36, 1);
  static const fast = Duration(milliseconds: 180);
  static const med = Duration(milliseconds: 320);
  static const slow = Duration(milliseconds: 520);

  /// The page ground: a wash from the palest ocean into white.
  static const Gradient backdrop = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [c50, Color(0xFFF7FDFE), Colors.white],
    stops: [0, 0.45, 1],
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
      primary: Ocean.c500,
      secondary: Ocean.c700,
      surface: Colors.white,
      error: Ocean.danger,
    ),
    scaffoldBackgroundColor: Ocean.c50,
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
      );

  return base.copyWith(
    textTheme: texte,
    visualDensity: VisualDensity.standard,
    splashFactory: InkSparkle.splashFactory,
    listTileTheme: const ListTileThemeData(
      iconColor: Ocean.c600,
      titleTextStyle: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Ocean.ink900, fontFamily: 'Plus Jakarta Sans'),
      subtitleTextStyle: TextStyle(fontSize: 12.5, color: Ocean.ink500, fontFamily: 'Plus Jakarta Sans'),
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
      color: Ocean.glassStrong,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Ocean.rMd),
        side: const BorderSide(color: Ocean.glassBorder),
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Ocean.c500,
        foregroundColor: Colors.white,
        // Its controls are pills.
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Ocean.rFull),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.8),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.glassBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.c100),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Ocean.rSm),
        borderSide: const BorderSide(color: Ocean.c500, width: 2),
      ),
      labelStyle: const TextStyle(color: Ocean.ink500),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white.withValues(alpha: 0.94),
      surfaceTintColor: Colors.transparent,
      indicatorColor: Ocean.c100,
      elevation: 0,
      height: 68,
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
    dividerTheme: const DividerThemeData(color: Ocean.c100, thickness: 1),
  );
}

/// A glass panel — its `.g-card`.
class GlassCard extends StatelessWidget {
  const GlassCard({super.key, required this.child, this.padding, this.strong = true});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: strong ? Ocean.glassStrong : Ocean.glass,
        borderRadius: BorderRadius.circular(Ocean.rMd),
        border: Border.all(color: Ocean.glassBorder),
        boxShadow: Ocean.shadow,
      ),
      child: child,
    );
  }
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
              decoration: const BoxDecoration(color: Ocean.c100, shape: BoxShape.circle),
              child: Icon(icone, size: 34, color: Ocean.c700),
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
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(Ocean.rMd)),
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
    final teintes = [Ocean.c600, Ocean.c700, const Color(0xFF7C3AED), const Color(0xFFDB2777), const Color(0xFF0F766E), const Color(0xFFB45309)];
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
