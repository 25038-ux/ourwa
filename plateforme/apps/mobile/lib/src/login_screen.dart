import 'package:flutter/material.dart';
import 'api.dart';
import 'serveur.dart';
import 'i18n.dart';
import 'telephone.dart';
import 'theme.dart';
import 'marque.dart';

/// L'ÉCRAN DE CONNEXION DU CORRESPONDANT — `parent_connexion.php`.
///
/// ⚠ REBUILT AGAINST THE REAL PAGE, NOT AGAINST ITS STYLESHEET. Reading
/// `parent.css` had given me a set of tokens and a guess at how they were
/// assembled; running the thing showed a screen with a completely different
/// shape — a deep teal hero carrying the school's pitch, then the sign-in card
/// beneath it.
///
/// On a phone its two columns stack, hero first, and that is exactly this
/// screen: `grid-template-columns: 1fr` under 900px.
///
/// ⚠ IT IS A PHONE NUMBER, NOT AN EMAIL. "Connectez-vous avec le numéro de
/// téléphone communiqué par l'école." A family in Nouakchott has a phone; many
/// have no email at all, and the school hands out the number it already holds.
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.api,
    required this.onSignedIn,
    required this.locale,
    required this.onLocaleChanged,
  });

  final ApiClient api;
  final VoidCallback onSignedIn;
  final Locale locale;
  final ValueChanged<Locale> onLocaleChanged;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    // Son `parent_connexion.php` : « Veuillez remplir tous les champs requis. »
    // (`t('champs_requis')`) avant toute tentative.
    if (_phone.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = t('champs_requis', widget.locale.languageCode));
      return;
    }
    // L'identifiant d'une famille est son numéro mauritanien, strictement —
    // la même règle que l'API, dite ici sans aller-retour.
    final numero = telephoneMauritanien(_phone.text);
    if (numero == null) {
      setState(() => _error = t('telephone_mauritanien_refus', widget.locale.languageCode));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.login(numero, _password.text);
      widget.onSignedIn();
    } on ApiException catch (e) {
      // Sa page affiche `$r['message']` de `tenter_connexion_parent()` tel quel :
      // « Numéro ou mot de passe incorrect. », « Compte verrouillé. Réessayez
      // dans N minute(s). », « Trop de tentatives échouées. Compte verrouillé
      // 15 minutes. », « Trop de tentatives depuis votre réseau… » — en
      // français quelle que soit la langue, comme chez lui.
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = t('erreur_reseau', widget.locale.languageCode));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.locale.languageCode;
    final arabic = lang == 'ar';

    return Scaffold(
      body: Stack(
        children: [
          // ── The hero, its gradient ────────────────────────────────────────
          // `linear-gradient(135deg, #0a2540 0%, #0e7490 50%, #06b6d4 100%)`
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF0A2540),
                    Color(0xFF0E7490),
                    Color(0xFF06B6D4)
                  ],
                  stops: [0, 0.5, 1],
                ),
              ),
            ),
          ),

          SafeArea(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Hero(
                    lang: lang,
                    onToggleLanguage: () => widget.onLocaleChanged(
                      arabic ? const Locale('fr') : const Locale('ar'),
                    ),
                  ),
                  _Card(
                    lang: lang,
                    phone: _phone,
                    password: _password,
                    obscure: _obscure,
                    onToggleObscure: () => setState(() => _obscure = !_obscure),
                    error: _error,
                    busy: _busy,
                    onSubmit: _submit,
                    api: widget.api,
                    onServeur: () => setState(() {}),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The teal half: the school's pitch, its three promises, its copyright.
class _Hero extends StatelessWidget {
  const _Hero({required this.lang, required this.onToggleLanguage});

  final String lang;
  final VoidCallback onToggleLanguage;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Its own mobile padding: `.login-hero { padding: 2rem 1.5rem; }`
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.school_outlined,
                    color: Colors.white, size: 24),
              ),
              const SizedBox(width: 12),
              Text(
                Marque.selon(lang),
                style: const TextStyle(
                  fontFamily: 'Fraunces',
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              const Spacer(),
              // Its language pill, top-right: a white pill on the teal.
              TextButton(
                onPressed: onToggleLanguage,
                style: TextButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Ocean.c700,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Ocean.rFull),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                ),
                child: Text(
                  lang == 'ar' ? 'FR' : 'العربية',
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
            ],
          ),

          const SizedBox(height: 36),

          // ⚠ TWO LINES, TWO TREATMENTS. The second is its light cyan and
          // ITALIC — `hero_titre_l1` plain, `hero_titre_l2` emphasised.
          Text(
            t('hero_titre_l1', lang),
            style: const TextStyle(
              fontFamily: 'Fraunces',
              fontSize: 35,
              height: 1.15,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          Text(
            t('hero_titre_l2', lang),
            style: const TextStyle(
              fontFamily: 'Fraunces',
              fontSize: 35,
              height: 1.15,
              fontWeight: FontWeight.w700,
              fontStyle: FontStyle.italic,
              color: Color(0xFFA5F3FC),
            ),
          ),

          const SizedBox(height: 20),
          Text(
            t('hero_lede', lang),
            style: TextStyle(
              fontSize: 17,
              height: 1.5,
              color: Colors.white.withValues(alpha: 0.92),
            ),
          ),

          const SizedBox(height: 28),
          // Its three feature pills, in its order.
          _Feature(
              icon: Icons.check_circle_outline, label: t('feat_notif', lang)),
          const SizedBox(height: 12),
          _Feature(icon: Icons.home_outlined, label: t('feat_classe', lang)),
          const SizedBox(height: 12),
          _Feature(icon: Icons.lock_outline, label: t('feat_secu', lang)),

          const SizedBox(height: 20),
          Text(
            t('footer_copyright', lang),
            style: TextStyle(
                fontSize: 13, color: Colors.white.withValues(alpha: 0.7)),
          ),
        ],
      ),
    );
  }
}

/// One promise — `rgba(255,255,255,.1)`, 16px radius, an icon tile beside it.
class _Feature extends StatelessWidget {
  const _Feature({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The pale half: "Bonjour 👋", the two fields, the button.
class _Card extends StatelessWidget {
  const _Card({
    required this.lang,
    required this.phone,
    required this.password,
    required this.obscure,
    required this.onToggleObscure,
    required this.error,
    required this.busy,
    required this.onSubmit,
    required this.api,
    required this.onServeur,
  });

  final String lang;
  final ApiClient api;
  final VoidCallback onServeur;
  final TextEditingController phone;
  final TextEditingController password;
  final bool obscure;
  final VoidCallback onToggleObscure;
  final String? error;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        // Its pale side, from `.login-panel`.
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFF7FBFC), Color(0xFFECFEFF)],
        ),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                t('bonjour', lang),
                style: const TextStyle(
                  fontFamily: 'Fraunces',
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  color: Ocean.ink900,
                ),
              ),
              const SizedBox(width: 8),
              const Text('👋', style: TextStyle(fontSize: 28)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            t('connectez_vous', lang),
            style: const TextStyle(
                fontSize: 15, height: 1.45, color: Ocean.ink500),
          ),

          if (error != null) ...[
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                border: Border.all(color: const Color(0xFFFECACA)),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline,
                      color: Color(0xFFDC2626), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      error!,
                      style: const TextStyle(
                          color: Color(0xFF991B1B), fontSize: 14.5),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 22),

          // Aucune école à choisir : l'application est une pour toutes les
          // branches, et la session d'une famille les couvre toutes.
          TextField(
            controller: phone,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            decoration: _dec(t('identifiant', lang)).copyWith(hintText: '22 12 34 56'),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: password,
            obscureText: obscure,
            onSubmitted: (_) => onSubmit(),
            decoration: _dec(t('mot_de_passe', lang)).copyWith(
              suffixIcon: IconButton(
                icon: Icon(obscure
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined),
                color: Ocean.ink500,
                onPressed: onToggleObscure,
              ),
            ),
          ),

          const SizedBox(height: 24),
          // Its button: the ocean gradient, 16px radius, full width.
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Ocean.c500, Ocean.c700],
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: busy ? null : onSubmit,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            t('se_connecter', lang),
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Icon(Icons.arrow_forward,
                              size: 18, color: Colors.white),
                        ],
                      ),
              ),
            ),
          ),
          // L'adresse du serveur, lisible sur le blanc de la carte — pas sur
          // le dégradé, où elle disparaissait.
          _LigneServeur(api: api, onChange: onServeur),
        ],
      ),
    );
  }

  /// Its fields: white, generous, softly rounded, no visible border until focus.
  InputDecoration _dec(String label) => InputDecoration(
        hintText: label,
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFCFFAFE)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFCFFAFE)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Ocean.c500, width: 2),
        ),
      );
}

/// L'ADRESSE DU SERVEUR, LISIBLE ET MODIFIABLE — sous le formulaire, pas cachée.
///
/// Discrète parce qu'un parent n'y touche jamais ; présente parce qu'il n'y a
/// pas encore de serveur de production, et qu'un paquet publié doit pouvoir
/// être pointé vers lui le jour où il existe, sans republier. Et parce qu'une
/// adresse modifiable ne doit pas être invisible : voir `Serveur`.
class _LigneServeur extends StatelessWidget {
  const _LigneServeur({required this.api, required this.onChange});

  final ApiClient api;
  final VoidCallback onChange;

  /// ⚠ UNE CONSTRUCTION DE PRODUCTION NE MONTRE PAS CETTE PORTE. Quand
  /// `API_URL` est une adresse https compilée dans le paquet, un parent n'a
  /// aucune raison de changer de serveur — et une adresse modifiable est ce
  /// qu'un escroc lui ferait changer. La ligne ne réapparaît que si CE
  /// téléphone vise déjà une autre adresse (un appareil d'essai), pour pouvoir
  /// revenir à celle de la construction.
  static bool get _figee => Serveur.parDefaut.startsWith('https://');

  @override
  Widget build(BuildContext context) {
    if (_figee && api.baseUrl == Serveur.parDefaut) return const SizedBox.shrink();
    final hote = Uri.tryParse(api.baseUrl)?.host ?? api.baseUrl;
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Flexible(
            child: Text(
              'Serveur : $hote',
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Ocean.ink500),
            ),
          ),
          TextButton(
            onPressed: () => _modifier(context),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('modifier', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }

  Future<void> _modifier(BuildContext context) async {
    final champ = TextEditingController(text: api.baseUrl);
    String? erreur;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          scrollable: true,
          title: const Text('Adresse du serveur'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: champ,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: InputDecoration(
                    hintText: 'https://api.votre-ecole.mr',
                    errorText: erreur,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Réservé à l\'école. Ne saisissez une adresse que si l\'école vous l\'a donnée.',
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                champ.text = Serveur.parDefaut;
                setState(() => erreur = null);
              },
              child: const Text('Par défaut'),
            ),
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Annuler')),
            TextButton(
              onPressed: () {
                final e = Serveur.valider(champ.text);
                if (e != null) {
                  setState(() => erreur = e);
                  return;
                }
                Navigator.pop(ctx, true);
              },
              child: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
    final adresse = champ.text;
    champ.dispose();
    if (ok == true) {
      await Serveur.choisir(adresse);
      await api.resoudreServeur();
      onChange();
    }
  }
}
