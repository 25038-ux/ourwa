import 'package:flutter/material.dart';
import 'api.dart';
import 'i18n.dart';
import 'messages_screen.dart';
import 'parent_shell.dart' show salutation;
import 'child_screen.dart';
import 'theme.dart';

/// The parent's home: their children, and what the family owes.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({
    super.key,
    required this.api,
    required this.onSignedOut,
    required this.locale,
    required this.onLocaleChanged,
    this.embedded = false,
  });

  final ApiClient api;
  final VoidCallback onSignedOut;
  final Locale locale;
  final ValueChanged<Locale> onLocaleChanged;

  /// True when rendered inside [ParentShell], which already provides the top
  /// bar, the background and the navigation. The screen then contributes only
  /// its own content — two chromes stacked would waste a third of a phone.
  final bool embedded;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<_Overview> _overview;

  /// Mirrored into state because the app bar renders outside the FutureBuilder
  /// that loads it.
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _overview = _loadAndCount();
  }

  Future<_Overview> _load() async {
    final children = await widget.api.get('/parent/children');
    final balance = await widget.api.get('/parent/balance');
    // The school having written to you must not be a reason the whole screen
    // fails to load, so an unreachable inbox degrades to "no unread".
    // ⚠ LE COMPTE SEUL. Lire `/parent/messages` marquait TOUT lu côté
    // serveur avant même que la famille ouvre Messages : badge à zéro, message
    // jamais vu, accusé de lecture faux pour l'école. Son `tableau_bord.php`
    // ne touche pas aux messages.
    final unread = await widget.api.unreadCount().catchError((_) => 0);
    return _Overview(
      academicYear: children['academicYear'] as String?,
      children: (children['children'] as List<dynamic>)
          .map((e) => Child.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      total: balance['total'] as String? ?? '0.00',
      months: (balance['tuition'] as List<dynamic>? ?? const []).length,
      unread: unread,
      familyName: children['guardianName'] as String? ?? '',
      plusieursEcoles: (children['ecoles'] as List<dynamic>? ?? const []).length > 1,
    );
  }

  Future<_Overview> _loadAndCount() async {
    final overview = await _load();
    if (mounted && overview.unread != _unread) {
      setState(() => _unread = overview.unread);
    }
    return overview;
  }

  Future<void> _reload() async {
    setState(() => _overview = _loadAndCount());
    await _overview;
  }

  @override
  Widget build(BuildContext context) {
    final isArabic = widget.locale.languageCode == 'ar';
    if (widget.embedded) return _body(context, isArabic);

    return Scaffold(
      appBar: AppBar(
        title: Text(isArabic ? 'أبنائي' : 'Mes enfants'),
        actions: [
          _MessagesButton(
            api: widget.api,
            isArabic: isArabic,
            unread: _unread,
            onReturn: _reload,
          ),
          IconButton(
            tooltip: isArabic ? 'Français' : 'العربية',
            onPressed: () => widget.onLocaleChanged(
              isArabic ? const Locale('fr') : const Locale('ar'),
            ),
            icon: Text(isArabic ? 'FR' : 'ع',
                style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
          IconButton(
            tooltip: isArabic ? 'خروج' : 'Déconnexion',
            onPressed: () async {
              await widget.api.logout();
              widget.onSignedOut();
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: _body(context, isArabic),
    );
  }

  /// The screen's own content, without chrome.
  ///
  /// Shared by the standalone screen and by the embedded tab, so the two can
  /// never drift into showing a family different things.
  Widget _body(BuildContext context, bool isArabic) {
    return RefreshIndicator(
    onRefresh: _reload,
    child: FutureBuilder<_Overview>(
      future: _overview,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Squelette(lignes: 3, hauteur: 150);
        }
        if (snapshot.hasError) {
          final lang = isArabic ? 'ar' : 'fr';
          return ListView(
            children: [
              EtatVide(
                icone: Icons.cloud_off_rounded,
                titre: lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
                texte: lang == 'ar' ? 'اسحب للأسفل لإعادة المحاولة.' : 'Tirez vers le bas pour réessayer.',
                action: FilledButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh), label: Text(lang == 'ar' ? 'إعادة المحاولة' : 'Réessayer')),
              ),
            ],
          );
        }
        final data = snapshot.data!;
        final lang = isArabic ? 'ar' : 'fr';

        // ⚠ THE GAP BETWEEN TWO SCHOOL YEARS. No active year means the family
        // sees this and NOT last year's marks — El Ourwa's own emphasis, and
        // the message is a promise rather than an apology: the information
        // comes back when the new year opens.
        if (data.academicYear == null) {
          return ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const SizedBox(height: 40),
              const Icon(Icons.event_busy_outlined, size: 56, color: Ocean.c300),
              const SizedBox(height: 16),
              Text(
                t('sans_annee_titre', lang),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: 'Fraunces',
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: Ocean.ink900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                t('sans_annee_texte', lang),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 15, height: 1.5, color: Ocean.ink500),
              ),
            ],
          );
        }

        final large = ecranLarge(context);
        final cartes = <Widget>[
          for (final (i, child) in data.children.indexed)
            Apparition(
              rang: i + 1,
              child: _ChildCard(
                child: child,
                lang: lang,
                ecole: data.plusieursEcoles ? child.school?.libelle(lang == 'ar') : null,
                // ⚠ Its card opens the CHILD screen, not the bulletin:
                // `onclick="window.location.href='enfant.php?id=…'"`. The
                // bulletin is one of that screen's four tabs.
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ChildScreen(api: widget.api, child: child, lang: lang),
                  ),
                ),
              ),
            ),
        ];

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ⚠ ITS GREETING, HOUR-AWARE AND NAMED. "Bonsoir, 46799090 👋" —
            // the salutation in the display serif, the family's own name picked
            // out in the accent — now in a hero card that says at a glance which
            // schools this family is in.
            Apparition(
              child: Container(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Ocean.c950, Ocean.c800, Ocean.c600],
                  ),
                  borderRadius: BorderRadius.circular(Ocean.rLg),
                  boxShadow: Ocean.shadowLg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    RichText(
                      text: TextSpan(
                        style: const TextStyle(fontFamily: 'Fraunces', fontSize: 25, fontWeight: FontWeight.w700, color: Colors.white, height: 1.15),
                        children: [
                          TextSpan(text: '${salutation(lang)}, '),
                          TextSpan(text: data.familyName, style: const TextStyle(color: Ocean.c200)),
                          const TextSpan(text: ' 👋'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      // Its own singular and plural: `apercu_enfant` / `apercu_enfants`.
                      t(data.childCount > 1 ? 'apercu_enfants' : 'apercu_enfant', lang),
                      style: const TextStyle(fontSize: 14.5, color: Colors.white70, height: 1.4),
                    ),
                    if (data.plusieursEcoles) ...[
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final e in widget.api.ecoles)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .14),
                                borderRadius: BorderRadius.circular(Ocean.rFull),
                                border: Border.all(color: Colors.white.withValues(alpha: .25)),
                              ),
                              child: Text(e.libelle(lang == 'ar'), style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w600)),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            if (data.children.isNotEmpty)
              // Deux colonnes sur un grand écran, une seule sur un téléphone ;
              // chaque carte garde sa hauteur naturelle (pas de cellule qui coupe).
              large
                  ? LayoutBuilder(
                      builder: (context, c) => Wrap(
                        spacing: 14,
                        children: [for (final w in cartes) SizedBox(width: (c.maxWidth - 14) / 2, child: w)],
                      ),
                    )
                  : Column(children: cartes),
            /**
             * ⚠ THE FAMILY'S BALANCE IS GONE FROM THIS SCREEN, DELIBERATELY.
             *
             * El Ourwa's parent space names no sum a family owes — anywhere.
             * The only mention of debt in all nine of its pages is the line
             * that WITHHOLDS the average because of one. The school does not
             * dun families through the app; it withholds results, and the
             * family comes to the counter.
             *
             * Publishing a computed arrears figure would also publish a number
             * the office treats as provisional — fees are negotiated per family
             * and concessions are often informal — and invite arguments about
             * arithmetic instead of conversations about circumstances.
             *
             * The balance endpoint stays: `/parent/balance` is what the exam
             * ratchet is computed from. It simply is not shown here.
             */
            if (data.children.isEmpty)
              EtatVide(
                icone: Icons.family_restroom_rounded,
                titre: isArabic ? 'لا يوجد أبناء مسجلون' : 'Aucun enfant inscrit',
                // L'école a ouvert l'année suivante et les réinscriptions ne
                // sont pas faites : l'application est vide EXPRÈS (comme chez
                // El Ourwa, jamais l'année passée à la place) — et le dit.
                texte: data.academicYear != null
                    ? (isArabic
                        ? 'السنة ${data.academicYear} مفتوحة ولم يُعد تسجيل أي طفل بعد. ما بقي مستحقاً يظل مستحقاً.'
                        : "L'année ${data.academicYear} est ouverte et aucune réinscription n'est encore faite. Ce qui reste dû le reste.")
                    : (isArabic ? 'اتصل بالمدرسة إذا كان هذا خطأ.' : "Contactez l'école si ce n'est pas normal."),
              ),
          ],
        );
      },
    ),
    );
  }
}

class _Overview {
  const _Overview({
    required this.academicYear,
    required this.children,
    required this.total,
    required this.months,
    required this.unread,
    required this.familyName,
    this.plusieursEcoles = false,
  });

  final String? academicYear;
  final List<Child> children;
  /// Une famille peut avoir des enfants dans plusieurs branches : le nom de
  /// l'école n'est écrit sur la carte que lorsqu'il y en a plus d'une.
  final bool plusieursEcoles;
  final String total;
  final int months;
  final int unread;
  /// The name its greeting picks out in the accent colour.
  final String familyName;

  int get childCount => children.length;
}

/// The inbox, with a count when something is waiting.
///
/// The badge is only shown when it has a number to show: a permanent "0" reads
/// as a broken badge, and a badge that is always there stops being noticed.
class _MessagesButton extends StatelessWidget {
  const _MessagesButton({
    required this.api,
    required this.isArabic,
    required this.unread,
    required this.onReturn,
  });

  final ApiClient api;
  final bool isArabic;
  final int unread;
  final Future<void> Function() onReturn;

  @override
  Widget build(BuildContext context) {
    final label = isArabic ? 'الرسائل' : 'Messages';
    final icon = Icon(unread > 0 ? Icons.mark_email_unread : Icons.mail_outline);
    return IconButton(
      tooltip: unread > 0 ? '$label ($unread)' : label,
      onPressed: () async {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => MessagesScreen(api: api, isArabic: isArabic),
          ),
        );
        await onReturn();
      },
      icon: unread > 0
          ? Badge.count(count: unread, child: icon)
          : icon,
    );
  }
}

/// UNE FICHE ENFANT — its `.child-card`.
///
/// ⚠ THE WHOLE OF WHAT ITS DASHBOARD SHOWS A FAMILY: who the child is, what
/// class they are in, their average and their absences. Two figures, side by
/// side, and a way in. Nothing about money.
///
/// ⚠ THE AVERAGE CARRIES "/20" IN SMALLER, FADED TYPE, because 9,56 alone is
/// ambiguous to a parent who has seen marks out of 10 and out of 40 on paper.
///
/// ⚠ AND WHEN THE FAMILY IS IN DEBT IT IS NOT THERE. The server sends null; the
/// card says so in its own terms rather than showing a dash that reads like a
/// child who sat nothing.
class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child, required this.lang, required this.onTap, this.ecole});

  final Child child;
  final String lang;
  final VoidCallback onTap;
  /// Le nom de l'école, quand la famille en a plusieurs.
  final String? ecole;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Ocean.rLg),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(Ocean.rLg),
            border: Border.all(color: Ocean.glassBorder),
            boxShadow: Ocean.shadow,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AvatarInitiales(nom: child.fullName, taille: 46),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          child.fullName,
                          style: const TextStyle(
                            fontFamily: 'Fraunces',
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            height: 1.25,
                            color: Ocean.ink900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            if (ecole != null) ecole!,
                            if (child.levelName != null) child.levelName!,
                            if (child.groupName != null) child.groupName!,
                          ].join(' \u00b7 '),
                          style: const TextStyle(fontSize: 14, color: Ocean.ink500),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Ocean.c600, size: 26),
                ],
              ),

              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Divider(height: 1),
              ),

              Row(
                children: [
                  Expanded(
                    child: _Stat(
                      value: child.average,
                      suffix: '/20',
                      label: t('moyenne', lang),
                      withheld: child.examsWithheld,
                      lang: lang,
                      accent: true,
                    ),
                  ),
                  Expanded(
                    child: _Stat(
                      value: '${child.absences}',
                      label: t('absences', lang),
                      lang: lang,
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 10),
              Text(
                '\ud83d\udc46 ${t('voir_details', lang)}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Ocean.c700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One of the two figures on a card — its `.stat-tile`.
class _Stat extends StatelessWidget {
  const _Stat({
    required this.value,
    required this.label,
    required this.lang,
    this.suffix,
    this.withheld = false,
    this.accent = false,
  });

  final String? value;
  final String? suffix;
  final String label;
  final String lang;
  final bool withheld;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // ⚠ AN EM DASH, AND THE "/20" GOES WITH IT — its own
        // `$moy_aff = … : '—'`. I had written an explanation into the tile;
        // El Ourwa keeps the card terse and puts the full notice on the
        // results screen, where a parent who wants to know why is already
        // looking. Two figures side by side stay readable at a glance.
        if (value == null)
          Text(
            '—',
            style: TextStyle(
              fontFamily: 'Fraunces',
              fontSize: 28,
              fontWeight: FontWeight.w700,
              color: accent ? Ocean.c700 : Ocean.ink900,
            ),
          )
        else
          RichText(
            text: TextSpan(
              style: TextStyle(
                fontFamily: 'Fraunces',
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: accent ? Ocean.c700 : Ocean.ink900,
              ),
              children: [
                TextSpan(text: formatAverage(value!)),
                if (suffix != null)
                  TextSpan(
                    text: suffix,
                    style: const TextStyle(fontSize: 16, color: Ocean.ink500),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 2),
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 11.5,
            letterSpacing: 0.6,
            fontWeight: FontWeight.w600,
            color: Ocean.ink500,
          ),
        ),
      ],
    );
  }
}

/// ITS AVERAGE FORMATTING — `rtrim(rtrim(number_format($m, 2, ',', ''), '0'), ',')`.
///
/// Two decimals, then trailing zeros stripped, then a trailing comma. So 9.56
/// prints "9,56", 10.00 prints "10", and 10.50 prints "10,5" — never "10,00",
/// which is what a naive two-decimal format would give and what makes a whole
/// mark look computed rather than achieved.
String formatAverage(String value) {
  final n = double.tryParse(value);
  if (n == null) return value;
  var s = n.toStringAsFixed(2).replaceAll('.', ',');
  while (s.endsWith('0')) {
    s = s.substring(0, s.length - 1);
  }
  if (s.endsWith(',')) s = s.substring(0, s.length - 1);
  return s;
}
