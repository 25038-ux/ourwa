import 'package:flutter/material.dart';
import 'api.dart';
import 'i18n.dart';
import 'theme.dart';

/// 🔒 SÉCURITÉ — `pages/parent/changer_mdp.php`.
///
/// ⚠ AND THE GATE ITSELF. El Ourwa lands an account still on its issued
/// password here and opens no other page: "Vous devez changer votre mot de
/// passe avant de continuer." Ours stored the flag, returned it at sign-in and
/// acted on it nowhere, so a password read out at the counter stayed valid for
/// ever.
///
/// Three fields, its three: current, new, confirmation. And its own order of
/// complaint — wrong current password first, then the confirmation, then the
/// policy. Telling somebody their new password is too weak before establishing
/// that they know the old one answers a question they were not asked.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({
    super.key,
    required this.api,
    required this.lang,
    required this.onChanged,
    this.forced = false,
    this.onSignOut,
  });

  final ApiClient api;
  final String lang;
  final VoidCallback onChanged;

  /// True when this is the gate rather than the Profil screen.
  final bool forced;
  final VoidCallback? onSignOut;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  String? _error;
  String? _ok;
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final lang = widget.lang;

    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      // Ses trois refus, dans son ordre, viennent du serveur : mot de passe
      // actuel, confirmation, politique.
      await widget.api.changePassword(_current.text, _next.text, _confirm.text);
      setState(() => _ok = t('mdp_change_succes', lang));
      widget.onChanged();
    } on ApiException catch (e) {
      // The server's own sentence, which names what would satisfy it.
      setState(() => _error = e.message);
    } catch (_) {
      // Hors ligne, mandataire en 502 : dire quelque chose, jamais rien.
      if (mounted) setState(() => _error = t('erreur_reseau', lang));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.lang;

    final body = ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
      children: [
        Text(
          '🔒 ${t('securite', lang)}',
          style: const TextStyle(
            fontFamily: 'Fraunces',
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: Ocean.ink900,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          t('securite_sous_titre', lang),
          style: const TextStyle(fontSize: 14.5, height: 1.4, color: Ocean.ink500),
        ),
        const SizedBox(height: 18),

        // ⚠ Its own notice when this is the gate rather than a choice.
        if (widget.forced)
          Container(
            padding: const EdgeInsets.all(14),
            margin: const EdgeInsets.only(bottom: 18),
            decoration: BoxDecoration(
              color: const Color(0xFFECFEFF),
              border: Border.all(color: Ocean.c200),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              t('changement_obligatoire', lang),
              style: const TextStyle(
                color: Ocean.c800,
                fontWeight: FontWeight.w600,
                height: 1.45,
                fontSize: 14.5,
              ),
            ),
          ),

        if (_error != null)
          _Notice(text: _error!, error: true)
        else if (_ok != null)
          _Notice(text: _ok!, error: false),

        _Field(label: t('mdp_actuel', lang), controller: _current),
        const SizedBox(height: 14),
        _Field(label: t('nouveau_mdp', lang), controller: _next),
        const SizedBox(height: 14),
        _Field(label: t('confirmer_mdp', lang), controller: _confirm),

        const SizedBox(height: 10),
        // What would satisfy the policy, said before it is refused rather than
        // after — the server's message is the same sentence.
        Text(
          t('regle_mdp', lang),
          style: const TextStyle(fontSize: 12.5, height: 1.4, color: Ocean.ink500),
        ),

        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? '…' : t('changer_mdp', lang)),
        ),

        if (widget.forced && widget.onSignOut != null) ...[
          const SizedBox(height: 12),
          TextButton(
            onPressed: widget.onSignOut,
            child: Text(t('deconnexion', lang)),
          ),
        ],
      ],
    );

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: Ocean.backdrop),
        child: SafeArea(child: body),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.controller});

  final String label;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: true,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.error});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: error ? const Color(0xFFFEF2F2) : const Color(0xFFECFDF5),
        border: Border.all(
          color: error ? const Color(0xFFFECACA) : const Color(0xFFA7F3D0),
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: error ? const Color(0xFF991B1B) : const Color(0xFF065F46),
          height: 1.45,
          fontSize: 14.5,
        ),
      ),
    );
  }
}
