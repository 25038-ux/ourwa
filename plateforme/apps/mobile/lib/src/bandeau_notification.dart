import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';
import 'marque.dart';

/// LE BANDEAU QUI SURGIT DANS L'APPLICATION — comme une messagerie moderne :
/// une carte descend du haut de l'écran avec l'icône, le titre et le texte de
/// la notification, un retour haptique, reste quatre secondes ou s'écarte
/// d'un geste vers le haut, et s'ouvre d'une touche. Il double la
/// notification système (barre d'état, son, vibration) pour la personne qui a
/// l'application sous les yeux — celle-là ne regarde pas la barre d'état.
class BandeauNotification {
  static OverlayEntry? _courant;
  static Timer? _minuteur;

  static void montrer(
    BuildContext context, {
    required String titre,
    required String corps,
    IconData icone = Icons.notifications_active_rounded,
    Color teinte = Ocean.c600,
    VoidCallback? onTap,
  }) {
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;
    fermer();
    HapticFeedback.mediumImpact();
    final entree = OverlayEntry(
      builder: (ctx) => _Bandeau(
        titre: titre,
        corps: corps,
        icone: icone,
        teinte: teinte,
        onTap: () {
          fermer();
          onTap?.call();
        },
        onEcarter: fermer,
      ),
    );
    _courant = entree;
    overlay.insert(entree);
    _minuteur = Timer(const Duration(seconds: 4), fermer);
  }

  static void fermer() {
    _minuteur?.cancel();
    _minuteur = null;
    final entree = _courant;
    _courant = null;
    if (entree != null) {
      entree.remove();
      entree.dispose();
    }
  }
}

class _Bandeau extends StatefulWidget {
  const _Bandeau({required this.titre, required this.corps, required this.icone, required this.teinte, required this.onTap, required this.onEcarter});
  final String titre;
  final String corps;
  final IconData icone;
  final Color teinte;
  final VoidCallback onTap;
  final VoidCallback onEcarter;

  @override
  State<_Bandeau> createState() => _BandeauState();
}

class _BandeauState extends State<_Bandeau> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 380))..forward();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final haut = MediaQuery.paddingOf(context).top;
    return Positioned(
      top: haut + 8,
      left: 10,
      right: 10,
      child: SlideTransition(
        position: Tween(begin: const Offset(0, -1.4), end: Offset.zero).animate(CurvedAnimation(parent: _c, curve: Curves.easeOutBack)),
        child: FadeTransition(
          opacity: _c,
          child: Dismissible(
            key: const ValueKey('bandeau'),
            direction: DismissDirection.up,
            onDismissed: (_) => widget.onEcarter(),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: widget.onTap,
                borderRadius: BorderRadius.circular(18),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: widget.teinte.withValues(alpha: .25)),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: .18), blurRadius: 24, offset: const Offset(0, 8)),
                    ],
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(color: widget.teinte.withValues(alpha: .12), borderRadius: BorderRadius.circular(13)),
                        child: Icon(widget.icone, color: widget.teinte, size: 23),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(widget.titre, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: Ocean.ink900)),
                                ),
                                const SizedBox(width: 6),
                                const Text(Marque.nom, style: TextStyle(fontSize: 11, color: Ocean.ink500, fontWeight: FontWeight.w600)),
                              ],
                            ),
                            if (widget.corps.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(widget.corps, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5, height: 1.35, color: Ocean.ink700)),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
