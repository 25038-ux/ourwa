import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../push.dart';
import '../sonnerie.dart';
import '../version.dart';
import '../i18n.dart';
import '../theme.dart';

/// Profil — `pages/parent/changer_mdp.php`.
///
/// ⚠ ITS ONLY JOB IS THE PASSWORD. El Ourwa's seventh nav entry is labelled
/// "Profil" but the page behind it is `changer_mdp.php`: a family cannot edit
/// their own name, their children, or their debt. The one thing they own is
/// their password, and a forced change on first login is why the screen exists.
class ProfilTab extends StatefulWidget {
  const ProfilTab({
    super.key,
    required this.api,
    required this.lang,
    required this.onSignedOut,
    required this.onLocaleChanged,
  });

  final ApiClient api;
  final String lang;
  final VoidCallback onSignedOut;
  final ValueChanged<Locale> onLocaleChanged;

  @override
  State<ProfilTab> createState() => _ProfilTabState();
}

class _ProfilTabState extends State<ProfilTab> {
  /// `POST /parent/devices/status` : le serveur pousse-t-il, ce jeton est-il connu ?
  late Future<Map<String, dynamic>?> _etatServeur = _lireEtatServeur();
  bool _testEnCours = false;

  Future<Map<String, dynamic>?> _lireEtatServeur() async {
    try {
      final jeton = Push.jeton;
      // Le jeton est une clé : dans le corps, jamais dans l'URL.
      return await widget.api.post('/parent/devices/status', jeton == null ? const {} : {'token': jeton});
    } catch (_) {
      return null;
    }
  }

  /// Le test de bout en bout : le serveur pousse une notification à CE compte.
  Future<void> _testerDepuisServeur(String lang) async {
    setState(() => _testEnCours = true);
    String message;
    try {
      final r = await widget.api.post('/parent/devices/test', const {});
      final appareils = (r['devices'] as num?)?.toInt();
      // Aucun téléphone déclaré : rien n'arrivera — on le dit, au lieu de
      // promettre « dans les secondes ».
      message = appareils == 0
          ? t('notifs_test_aucun_appareil', lang)
          : r['push'] == 'firebase'
              ? t('notifs_test_envoyee', lang)
              : t('notifs_test_sondage', lang);
    } catch (_) {
      message = t('erreur_reseau', lang);
    }
    if (!mounted) return;
    setState(() {
      _testEnCours = false;
      _etatServeur = _lireEtatServeur();
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _ok;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // ⚠ LA LANGUE VIVANTE, PAS CELLE DU MOMENT OÙ L'ÉCRAN A ÉTÉ OUVERT. Cet écran
    // est poussé comme une route à part avec `widget.lang` figé ; le bouton de
    // langue qu'il porte changeait `MaterialApp.locale` — la mise en page se
    // retournait — mais ses propres libellés restaient dans l'ancienne langue,
    // moitié arabe, moitié français. `Localizations` suit la locale en cours.
    final lang =
        Localizations.maybeLocaleOf(context)?.languageCode ?? widget.lang;
    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      // Ses trois refus, dans son ordre, viennent du serveur (`changer_mdp.php`).
      await widget.api.changePassword(_current.text, _next.text, _confirm.text);
      if (!mounted) return;
      setState(() {
        _ok = t('mdp_change_succes', lang);
        _current.clear();
        _next.clear();
        _confirm.clear();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // ⚠ LA LANGUE VIVANTE, PAS CELLE DU MOMENT OÙ L'ÉCRAN A ÉTÉ OUVERT. Cet écran
    // est poussé comme une route à part avec `widget.lang` figé ; le bouton de
    // langue qu'il porte changeait `MaterialApp.locale` — la mise en page se
    // retournait — mais ses propres libellés restaient dans l'ancienne langue,
    // moitié arabe, moitié français. `Localizations` suit la locale en cours.
    final lang =
        Localizations.maybeLocaleOf(context)?.languageCode ?? widget.lang;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
      children: [
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('changer_mdp', lang),
                style: const TextStyle(
                  fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'],
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 14),
              if (_error != null) _Banner(text: _error!, colour: Ocean.danger),
              if (_ok != null) _Banner(text: _ok!, colour: Ocean.success),
              TextField(
                controller: _current,
                obscureText: true,
                decoration: InputDecoration(labelText: t('mdp_actuel', lang)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _next,
                obscureText: true,
                decoration: InputDecoration(labelText: t('nouveau_mdp', lang)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _confirm,
                obscureText: true,
                onSubmitted: (_) => _submit(),
                decoration:
                    InputDecoration(labelText: t('confirmer_mdp', lang)),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? '…' : t('enregistrer', lang)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        // ⚠ CHAQUE MAILLON SE LIT (23/09/2026). « Notifications are far from
        // instant » n'avait aucune réponse mesurable : la version est-elle
        // compilée avec Firebase, la permission est-elle accordée, le jeton
        // est-il déclaré, le serveur a-t-il sa clé ? Et un test de bout en bout.
        _CarteNotifications(
          lang: lang,
          etatServeur: _etatServeur,
          testEnCours: _testEnCours,
          onTester: () => _testerDepuisServeur(lang),
          onTesterLocal: () async {
            final ok = await Sonnerie.demanderPermission();
            if (ok) {
              await Sonnerie.afficher(t('sonnerie_test_titre', lang), t('sonnerie_test_corps', lang));
            }
            if (context.mounted) setState(() => _etatServeur = _lireEtatServeur());
          },
        ),
        if (widget.api.phones.isNotEmpty) ...[
          const SizedBox(height: 12),
          GlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('numeros_compte', lang), style: const TextStyle(fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'], fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                for (final p in widget.api.phones)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(children: [
                      const Icon(Icons.phone_outlined, size: 16, color: Ocean.c600),
                      const SizedBox(width: 8),
                      // LTR même en arabe : les groupes de chiffres ne se lisent pas à l'envers.
                      Text(p.replaceAllMapped(RegExp(r'(\d{2})(?=\d)'), (m) => '${m[1]} '), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                    ]),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        GlassCard(
          child: Column(
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.translate, color: Ocean.c600),
                title: Text(lang == 'ar' ? 'Français' : 'العربية'),
                onTap: () => widget.onLocaleChanged(
                  lang == 'ar' ? const Locale('fr') : const Locale('ar'),
                ),
              ),
              const Divider(height: 1),
              // ⚠ Les magasins exigent que la politique soit lisible sans
              // compte : elle vit sur le site, dans la langue de l'écran.
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading:
                    const Icon(Icons.privacy_tip_outlined, color: Ocean.c600),
                title: Text(t('confidentialite', lang)),
                onTap: () => _ouvrirLegal('confidentialite', lang),
              ),
              const Divider(height: 1),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading:
                    const Icon(Icons.description_outlined, color: Ocean.c600),
                title: Text(t('conditions', lang)),
                onTap: () => _ouvrirLegal('conditions', lang),
              ),
              const Divider(height: 1),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.info_outline, color: Ocean.c600),
                title: Text(
                  t('version_serveur', lang)
                      .replaceAll('{version}', versionApplication)
                      .replaceAll('{serveur}', widget.api.baseUrl.replaceFirst(RegExp(r'^https?://'), '')),
                  style: const TextStyle(fontSize: 13),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.logout, color: Ocean.danger),
                title: Text(
                  t('deconnexion', lang),
                  style: const TextStyle(color: Ocean.danger),
                ),
                onTap: () async {
                  await widget.api.logout();
                  widget.onSignedOut();
                },
              ),
              const Divider(height: 1),
              // ⚠ App Store 5.1.1(v) et Play : la suppression du compte se fait
              // ICI, sans site ni courriel. Le mot de passe est exigé — une
              // session volée ne doit pas pouvoir supprimer un compte.
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.delete_forever_outlined,
                    color: Ocean.danger),
                title: Text(
                  t('supprimer_compte', lang),
                  style: const TextStyle(color: Ocean.danger),
                ),
                onTap: () => _supprimerCompte(context, lang),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Le site sert `/legal/<doc>?lang=` ; son adresse dérive de celle de l'API
  /// (`WEB_URL` par --dart-define, sinon le même hôte sur le port du site).
  Future<void> _ouvrirLegal(String doc, String lang) async {
    const web = String.fromEnvironment('WEB_URL', defaultValue: '');
    // Sans WEB_URL : le site est l'API sans son préfixe « api. » (production,
    // https://api.<domaine> → https://<domaine>) ou sur le port 3000 (poste de
    // développement). Avant, https://api.<domaine>/legal/… tombait sur l'API : 404.
    final base = web.isNotEmpty
        ? web
        : widget.api.baseUrl
            .replaceFirst(RegExp(r':3001$'), ':3000')
            .replaceFirst('://api.', '://');
    final uri = Uri.parse('$base/legal/$doc?lang=$lang');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _supprimerCompte(BuildContext context, String lang) async {
    final mdp = TextEditingController();
    String? erreur;
    final confirme = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          // ⚠ BORNÉ ET DÉFILANT. Un `Column` avec un champ de texte demande une
          // largeur infinie à la boîte, qui débordait de l'écran ; et sur une
          // fenêtre basse les boutons « Annuler » / « Supprimer » passaient sous
          // le bord, hors de portée. Vu en 800×600 — un téléphone couché fait pareil.
          scrollable: true,
          title: Text(t('supprimer_compte', lang)),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('supprimer_compte_explication', lang),
                    style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 12),
                TextField(
                  controller: mdp,
                  obscureText: true,
                  autofocus: true,
                  decoration: InputDecoration(
                    labelText: t('supprimer_compte_confirmer', lang),
                    errorText: erreur,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(t('annuler', lang))),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Ocean.danger),
              onPressed: () async {
                try {
                  await widget.api.post(
                      '/auth/delete-account', {'currentPassword': mdp.text});
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } on ApiException catch (e) {
                  if (ctx.mounted) setDialog(() => erreur = e.message);
                } catch (_) {
                  if (ctx.mounted) setDialog(() => erreur = t('erreur_reseau', lang));
                }
              },
              child: Text(t('supprimer_definitivement', lang)),
            ),
          ],
        ),
      ),
    );
    mdp.dispose();
    if (confirme != true) return;
    // Le serveur a déjà tout révoqué ; on efface ce que l'appareil garde.
    await widget.api.logout();
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(t('compte_supprime', lang))));
    }
    widget.onSignedOut();
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.colour});

  final String text;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(Ocean.rSm),
        border: Border.all(color: colour.withValues(alpha: 0.3)),
      ),
      child: Text(text, style: TextStyle(color: colour, fontSize: 13)),
    );
  }
}

/// LA CARTE « NOTIFICATIONS » DU PROFIL — chaque maillon de la chaîne, et
/// deux tests : la sonnerie (le canal du téléphone) et une notification
/// poussée par le serveur (toute la chaîne, application fermée comprise).
class _CarteNotifications extends StatelessWidget {
  const _CarteNotifications({
    required this.lang,
    required this.etatServeur,
    required this.testEnCours,
    required this.onTester,
    required this.onTesterLocal,
  });

  final String lang;
  final Future<Map<String, dynamic>?> etatServeur;
  final bool testEnCours;
  final VoidCallback onTester;
  final VoidCallback onTesterLocal;

  Widget _ligne(bool? ok, String texte) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              ok == null ? Icons.help_outline : ok ? Icons.check_circle_rounded : Icons.error_outline_rounded,
              size: 18,
              color: ok == null ? Ocean.ink500 : ok ? Ocean.success : Ocean.danger,
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(texte, style: const TextStyle(fontSize: 13.5, height: 1.35))),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final etat = Push.etat;
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('notifs_titre', lang), style: const TextStyle(fontFamily: 'Fraunces', fontFamilyFallback: ['Noto Sans Arabic'], fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          _ligne(etat.compile, etat.compile ? t('notifs_compilees', lang) : t('notifs_non_compilees', lang)),
          FutureBuilder<bool>(
            future: Sonnerie.permissionAccordee(),
            builder: (context, s) => _ligne(s.data, s.data == false ? t('notifications_refusees', lang) : t('notifications_autorisees', lang)),
          ),
          FutureBuilder<Map<String, dynamic>?>(
            future: etatServeur,
            builder: (context, s) {
              final fini = s.connectionState == ConnectionState.done;
              final d = fini ? s.data : null;
              // « Déclaré » d'après LE SERVEUR quand il a répondu : un jeton que
              // Google a déclaré mort est retiré de la table, et l'application
              // ne le sait pas — sa propre mémoire dirait encore « déclaré ».
              final connu = d?['registered'] as bool?;
              final declare = connu == null ? etat.declare : etat.declare && connu;
              final firebase = d?['push'] == 'firebase';
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (etat.compile)
                    _ligne(
                      declare,
                      declare
                          ? t('notifs_jeton', lang)
                          : etat.erreur == null || connu == false
                              ? t('notifs_jeton_absent', lang)
                              : t('notifs_jeton_erreur_${etat.erreur}', lang),
                    ),
                  if (!fini)
                    _ligne(null, '…')
                  else if (d == null)
                    _ligne(null, t('notifs_serveur_inconnu', lang))
                  else
                    _ligne(firebase, firebase ? t('notifs_serveur_firebase', lang) : t('notifs_serveur_sondage', lang)),
                ],
              );
            },
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: onTesterLocal,
                icon: const Icon(Icons.vibration_rounded, size: 18),
                label: Text(t('tester_sonnerie', lang)),
              ),
              FilledButton.icon(
                onPressed: testEnCours ? null : onTester,
                icon: testEnCours
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.send_rounded, size: 18),
                label: Text(t('notifs_test_serveur', lang)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
