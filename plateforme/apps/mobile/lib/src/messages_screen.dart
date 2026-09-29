import 'package:flutter/material.dart';
import 'theme.dart';
import 'api.dart';

/// One message from the school to this family.
///
/// `readAt` is nullable and stays that way: "not yet opened" and "opened at an
/// unknown time" are different states, and collapsing them into a boolean would
/// lose the one the school actually reports on.
class SchoolMessage {
  const SchoolMessage({
    required this.id,
    required this.sender,
    required this.subject,
    required this.body,
    required this.sentAt,
    required this.readAt,
  });

  factory SchoolMessage.fromJson(Map<String, dynamic> json) => SchoolMessage(
        id: json['id'] as String,
        sender: json['sender_name'] as String? ?? '',
        subject: json['subject'] as String? ?? '',
        body: json['body'] as String? ?? '',
        sentAt: DateTime.tryParse(json['sent_at'] as String? ?? ''),
        readAt: json['read_at'] == null
            ? null
            : DateTime.tryParse(json['read_at'] as String),
      );

  final String id;
  final String sender;
  final String subject;
  final String body;
  final DateTime? sentAt;
  final DateTime? readAt;

  bool get unread => readAt == null;
}

/// The family's messages from the school.
///
/// Opening one marks it read — once, on the server. The school watches that
/// figure to know whether an announcement actually landed, so it is recorded
/// when the message is genuinely opened and read, never merely when the list
/// scrolls past it.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, required this.api, required this.isArabic});

  final ApiClient api;
  final bool isArabic;

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  late Future<List<SchoolMessage>> _messages;

  @override
  void initState() {
    super.initState();
    _messages = _load();
  }

  Future<List<SchoolMessage>> _load() async {
    final data = await widget.api.get('/parent/messages');
    return (data['messages'] as List<dynamic>)
        .map((e) => SchoolMessage.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> _open(SchoolMessage message) async {
    if (message.unread) {
      // Fire the read stamp before showing the text, but never let a failed
      // stamp keep the family from reading their own message.
      await widget.api
          .post('/parent/messages/${message.id}/read', const <String, dynamic>{})
          .catchError((_) => <String, dynamic>{});
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message.subject,
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(
                '${message.sender}${message.sentAt == null ? '' : ' · ${_date(message.sentAt!)}'}',
                style: Theme.of(context).textTheme.labelMedium,
              ),
              const SizedBox(height: 16),
              Text(message.body, style: Theme.of(context).textTheme.bodyLarge),
            ],
          ),
        ),
      ),
    );
    if (mounted) setState(() => _messages = _load());
  }

  @override
  Widget build(BuildContext context) {
    final ar = widget.isArabic;
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'الرسائل' : 'Messages')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _messages = _load());
          await _messages;
        },
        child: FutureBuilder<List<SchoolMessage>>(
          future: _messages,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Squelette(lignes: 5, hauteur: 72);
            }
            if (snapshot.hasError) {
              return ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  const Icon(Icons.cloud_off, size: 44),
                  const SizedBox(height: 12),
                  Text('${snapshot.error}', textAlign: TextAlign.center),
                ],
              );
            }
            final messages = snapshot.data!;
            if (messages.isEmpty) {
              return ListView(
                children: [
                  EtatVide(
                    icone: Icons.mark_email_read_outlined,
                    titre: ar ? 'لا توجد رسائل من المدرسة.' : "L'école ne vous a pas encore écrit.",
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: messages.length,
              separatorBuilder: (_, __) => const SizedBox(height: 4),
              itemBuilder: (context, i) {
                final m = messages[i];
                return Card(
                  child: ListTile(
                    // Unread is carried by weight and a dot, not by colour
                    // alone — the distinction has to survive a colour-blind
                    // reader and a bright Nouakchott afternoon.
                    leading: Icon(
                      m.unread ? Icons.mark_email_unread : Icons.drafts_outlined,
                      color: m.unread
                          ? Theme.of(context).colorScheme.primary
                          : null,
                    ),
                    title: Text(
                      m.subject,
                      style: TextStyle(
                        fontWeight:
                            m.unread ? FontWeight.w700 : FontWeight.w400,
                      ),
                    ),
                    subtitle: Text(
                      '${m.sender}${m.sentAt == null ? '' : ' · ${_date(m.sentAt!)}'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open(m),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

String _date(DateTime at) {
  final d = at.toLocal();
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}
