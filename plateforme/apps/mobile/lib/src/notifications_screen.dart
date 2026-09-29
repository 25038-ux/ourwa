import 'package:flutter/material.dart';
import 'api.dart';
import 'i18n.dart';
import 'theme.dart';

/// LES NOTIFICATIONS DE LA FAMILLE — the event stream.
///
/// ⚠ THE TABLE WAS WRITE-ONLY AND THIS SCREEN DID NOT EXIST. Rows have been
/// written since homework shipped — an exercise sent, a timetable published —
/// and nothing in the system read one back: no endpoint, no screen, no badge. A
/// school sent an exercise to thirty families and none of them were told.
///
/// Different from Messages, which is the messagerie: a person writing to a
/// person. This is what the SYSTEM says happened — an absence recorded, a mark
/// entered, an exercise given, a timetable published.
///
/// ⚠ MARK NOTIFICATIONS ARE WITHHELD SERVER-SIDE from a family in debt, and the
/// app does not try to be clever about it: it renders what it is given, and the
/// unread count it is given already agrees with the list it is given. A badge
/// that disagreed with the list would send a parent looking for something they
/// are not allowed to see, and then to the office to ask why.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.api, required this.lang});

  final ApiClient api;
  final String lang;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<({List<ParentNotification> items, int unread})> _feed;

  @override
  void initState() {
    super.initState();
    _feed = widget.api.notifications();
  }

  void _reload() => setState(() => _feed = widget.api.notifications());

  Future<void> _markAll() async {
    // A failure here must not look like success: the family would come back to
    // the same badge and conclude the button does nothing.
    await widget.api.markAllNotificationsRead();
    if (mounted) _reload();
  }

  Future<void> _open(ParentNotification n) async {
    if (n.unread) {
      // Never let a failed read-stamp keep a family from their own notification.
      await widget.api
          .markNotificationRead(n.id)
          .catchError((_) => <String, dynamic>{});
    }
    if (!mounted) return;
    final texte = notificationTexte(n.i18nKey, n.params, widget.lang);
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(texte.titre, style: Theme.of(context).textTheme.titleLarge),
            if (n.createdAt != null) ...[
              const SizedBox(height: 4),
              Text(_date(n.createdAt!),
                  style: Theme.of(context).textTheme.labelMedium),
            ],
            if (texte.corps.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(texte.corps, style: Theme.of(context).textTheme.bodyLarge),
            ],
          ],
        ),
      ),
    );
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final lang = widget.lang;
    return Scaffold(
      appBar: AppBar(
        title: Text(t('notifications', lang)),
        actions: [
          IconButton(
            tooltip: t('tout_marquer_lu', lang),
            onPressed: _markAll,
            icon: const Icon(Icons.done_all),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          _reload();
          await _feed;
        },
        child: FutureBuilder<({List<ParentNotification> items, int unread})>(
          future: _feed,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Squelette(lignes: 6, hauteur: 76);
            }
            if (snapshot.hasError) {
              return ListView(
                children: [
                  EtatVide(
                    icone: Icons.cloud_off_rounded,
                    titre: lang == 'ar' ? 'تعذر الاتصال بالخادم' : 'Le serveur ne répond pas',
                    texte: lang == 'ar' ? 'اسحب للأسفل لإعادة المحاولة.' : 'Tirez vers le bas pour réessayer.',
                  ),
                ],
              );
            }
            final items = snapshot.data!.items;
            if (items.isEmpty) {
              // ⚠ Its own words. "Aucune notification." is a calm statement of
              // fact; a blank screen is a bug report.
              return ListView(
                children: [
                  EtatVide(
                    icone: Icons.notifications_none_rounded,
                    titre: t('aucune_notif', lang),
                    texte: lang == 'ar' ? 'ستظهر هنا النقاط والغيابات والتمارين والرسائل.' : 'Notes, absences, exercices et messages arriveront ici.',
                  ),
                ],
              );
            }
            // Regroupées par jour — « Aujourd'hui », « Hier », puis la date —
            // avec un point de non-lu, l'icône du genre dans une pastille, et
            // l'heure relative : le fil se lit d'un coup d'œil, comme une messagerie.
            final groupes = <String, List<ParentNotification>>{};
            for (final n in items) {
              groupes.putIfAbsent(_jour(n.createdAt, lang), () => []).add(n);
            }
            var rang = 0;
            return ListView(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
              children: [
                for (final e in groupes.entries) ...[
                  TitreSection(e.key),
                  for (final n in e.value)
                    Apparition(
                      rang: rang++,
                      child: _Ligne(n: n, lang: lang, onTap: () => _open(n)),
                    ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// One glyph per kind, so the stream is scannable without reading it.
IconData iconeNotification(String kind) => switch (kind) {
      'homework' => Icons.assignment_outlined,
      'timetable' => Icons.calendar_month_outlined,
      'grade' => Icons.grade_outlined,
      'absence' => Icons.event_busy_outlined,
      'remark' => Icons.rate_review_outlined,
      _ => Icons.notifications_none,
    };

String _date(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';

/// « Aujourd'hui » / « Hier » / la date, dans la langue de l'écran.
String _jour(DateTime? d, String lang) {
  if (d == null) return lang == 'ar' ? 'سابقاً' : 'Plus tôt';
  final now = DateTime.now();
  final j = DateTime(d.year, d.month, d.day);
  final aujourdhui = DateTime(now.year, now.month, now.day);
  final diff = aujourdhui.difference(j).inDays;
  if (diff == 0) return lang == 'ar' ? 'اليوم' : "Aujourd'hui";
  if (diff == 1) return lang == 'ar' ? 'أمس' : 'Hier';
  return _date(d) + (d.year != now.year ? '/${d.year}' : '');
}

/// L'heure si c'est aujourd'hui, sinon rien (le jour est déjà en titre).
String _heure(DateTime? d) {
  if (d == null) return '';
  final l = d.toLocal();
  return '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

class _Ligne extends StatelessWidget {
  const _Ligne({required this.n, required this.lang, required this.onTap});
  final ParentNotification n;
  final String lang;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final texte = notificationTexte(n.i18nKey, n.params, lang);
    final th = Theme.of(context).textTheme;
    final teinte = teinteNotification(n.kind);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: n.unread ? Colors.white : Colors.white.withValues(alpha: .62),
        borderRadius: BorderRadius.circular(Ocean.rMd),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Ocean.rMd),
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Ocean.rMd),
              border: Border.all(color: n.unread ? Ocean.c200 : Ocean.c100),
              boxShadow: n.unread ? Ocean.shadow : null,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(color: teinte.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
                  child: Icon(iconeNotification(n.kind), color: teinte, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              texte.titre,
                              style: th.titleMedium?.copyWith(fontWeight: n.unread ? FontWeight.w700 : FontWeight.w600),
                            ),
                          ),
                          Text(_heure(n.createdAt), style: th.bodySmall),
                          if (n.unread) ...[
                            const SizedBox(width: 6),
                            Container(width: 8, height: 8, decoration: const BoxDecoration(color: Ocean.c500, shape: BoxShape.circle)),
                          ],
                        ],
                      ),
                      if (texte.corps.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(texte.corps, maxLines: 3, overflow: TextOverflow.ellipsis, style: th.bodyMedium),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Color teinteNotification(String kind) => switch (kind) {
      'homework' => const Color(0xFF7C3AED),
      'timetable' => Ocean.c700,
      'grade' => const Color(0xFF0F766E),
      'absence' => Ocean.danger,
      'remark' => const Color(0xFFB45309),
      _ => Ocean.c600,
    };
