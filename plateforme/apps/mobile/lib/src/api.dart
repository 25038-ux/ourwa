import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'auth/auth_store.dart';
import 'serveur.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The API client for the parent app.
///
/// Tokens live in `flutter_secure_storage` — iOS Keychain / Android Keystore
/// (ARCHITECTURE.md §5). The refresh token is long-lived and rotated on every
/// use, so a parent logs in once per device and never sees the screen again.
class ApiClient {
  ApiClient({String? baseUrl, AuthStore? store, http.Client? client})
      : baseUrl = baseUrl ?? Serveur.parDefaut,
        _store = store ?? AuthStore(),
        // ⚠ UN DÉLAI SUR CHAQUE REQUÊTE : sans lui, un réseau qui accepte la
        // connexion et ne répond jamais (Wi-Fi sans liaison, serveur saturé)
        // laissait le voyant de lancement tourner sans fin — le cas même que
        // « entrer quand même » devait couvrir.
        _http = client ?? _ClientAvecDelai(http.Client());

  /// L'adresse du serveur. Celle de la construction, ou celle que cet
  /// appareil a choisie (`Serveur`) — d'où un champ et non une constante.
  String baseUrl;

  /// Appliquer l'adresse choisie sur l'appareil, s'il y en a une. Au
  /// démarrage, avant toute requête.
  Future<void> resoudreServeur() async {
    baseUrl = await Serveur.resoudre();
  }
  final AuthStore _store;

  /// Injectable so the retry-and-refresh path can be tested at all. It could
  /// not be before: every call went through the top-level `http.get`/`http.post`
  /// functions, which nothing can stand in for.
  final http.Client _http;

  String? _access;

  /// The refresh in flight, if there is one.
  ///
  /// ⚠ CONCURRENT 401s MUST NOT EACH ROTATE. A screen that loads three panels
  /// fires three requests; when the access token has expired all three come back
  /// 401 and all three used to call [refresh] with the SAME stored token. The
  /// first rotated it; the second presented a spent one — which is exactly the
  /// reuse the server exists to punish, and it revokes the whole family. Two
  /// panels loading in parallel signed the parent out of every device they own.
  ///
  /// One flight, shared by every caller that arrives while it is running.
  Future<bool>? _inFlight;

  /// ⚠ Still on the password the school issued.
  ///
  /// El Ourwa lands such an account on its password screen and opens no other
  /// page. Ours stored the flag, returned it at sign-in, and acted on it
  /// nowhere — so a password read out at the counter stayed valid for ever.
  bool mustChangePassword = false;

  /// La langue du compte (`users.locale`, son `parents.langue`) — lue à la
  /// connexion et à la restauration, appliquée si l'appareil n'a rien choisi.
  String? profileLocale;

  /// Restore a session on launch.
  ///
  /// Only the REFRESH token is persisted. The access token lasts 15 minutes and
  /// is cheap to re-obtain, so keeping it on disk would only widen the window an
  /// attacker has to work with — see AuthStore.
  Future<void> restore() async {
    // UNE APPLICATION POUR TOUTES LES BRANCHES (décision du propriétaire,
    // 2026-09-14) : la session d'une famille ne porte aucune école — l'API
    // parcourt celles où le compte est parent. Un profil d'avant, qui gardait
    // un `slug`, est simplement ignoré.
    if (await _store.readRefreshToken() == null) return;
    // ⚠ COMME WHATSAPP : UNE SESSION GARDÉE EST UNE SESSION. Si le serveur ne
    // répond pas à cet instant (il dort, le réseau manque), `refresh()` rend
    // false SANS effacer le jeton — et l'application entrait quand même sur
    // l'écran de connexion, « il faut se reconnecter à chaque fois ». Le
    // jeton est là : l'application s'ouvre, et réessaie en arrière-plan
    // (`credentialGardee`, `reessayer()`).
    if (!await refresh()) {
      credentialGardee = await _store.readRefreshToken() != null;
      return;
    }
    credentialGardee = true;

    // ⚠ RE-ASKED ON EVERY LAUNCH, because a restored session never goes
    // through the login screen that carried the answer. Without this a parent
    // who closes the app on the password screen reopens it past the gate.
    try {
      final me = await get('/auth/me');
      mustChangePassword = me['mustChangePassword'] as bool? ?? false;
      profileLocale = me['locale'] as String?;
      ecoles = _ecolesDe(me['ecoles']);
      phones = _phonesDe(me['phones']);
    } catch (_) {
      // Unreachable: keep the last known answer rather than guessing "no".
    }
  }

  bool get hasSession => _access != null;

  /// Un jeton de rafraîchissement existe sur l'appareil : la personne est
  /// connectée, que le serveur ait répondu ou non à l'ouverture.
  bool credentialGardee = false;

  /// Réessayer d'ouvrir la session gardée (le serveur s'est réveillé, le
  /// réseau est revenu). Vrai quand un jeton d'accès a été obtenu.
  Future<bool> reessayer() async {
    if (_access != null) return true;
    if (!await refresh()) {
      credentialGardee = await _store.readRefreshToken() != null;
      return false;
    }
    try {
      final me = await get('/auth/me');
      mustChangePassword = me['mustChangePassword'] as bool? ?? false;
      profileLocale = me['locale'] as String?;
      ecoles = _ecolesDe(me['ecoles']);
      phones = _phonesDe(me['phones']);
    } catch (_) {}
    return true;
  }

  /// Les écoles de la famille, telles que `/auth/me` les donne.
  List<Ecole> ecoles = const [];

  /// Les numéros supplémentaires qui ouvrent ce compte (0041), pour le profil.
  List<String> phones = const [];

  static List<String> _phonesDe(Object? brut) =>
      brut is List ? brut.map((e) => '$e').where((e) => e.isNotEmpty).toList(growable: false) : const [];

  Map<String, String> _headers({bool json = false}) => {
        'Accept': 'application/json',
        if (json) 'Content-Type': 'application/json',
        if (_access != null) 'Authorization': 'Bearer $_access',
      };

  /// La connexion d'une famille : un numéro mauritanien, un mot de passe —
  /// aucune école. `espace: parent` ouvre une session sur TOUTES les écoles
  /// où le compte est parent, avec les phrases de son espace des familles.
  Future<void> login(String identifier, String password) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'identifier': identifier, 'password': password, 'espace': 'parent'}),
    );
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    // ⚠ 201, PAS 200. Nest répond 201 à tout POST par défaut, et l'API l'a toujours
    // fait ; ce test exigeait 200, donc CHAQUE connexion réussie était rejetée
    // comme « identifiants incorrects » — avec le jeton déjà dans la réponse. Les
    // tests de widget, eux, répondaient 200 en simulant. Trouvé en se
    // connectant vraiment, depuis le navigateur, contre l'API réelle.
    if (response.statusCode < 200 || response.statusCode >= 300 || body['accessToken'] == null) {
      // The API is deliberately vague about which half was wrong.
      throw ApiException(
        (body['message'] as String?) ?? 'Connexion refusée',
        response.statusCode,
      );
    }
    _access = body['accessToken'] as String;
    final user = body['user'] as Map<String, dynamic>?;
    mustChangePassword = user?['mustChangePassword'] as bool? ?? false;
    profileLocale = user?['locale'] as String?;
    ecoles = _ecolesDe(body['ecoles']);
    // Les numéros du compte ne voyagent pas dans la réponse de connexion : le
    // profil les lit à la prochaine ouverture (`/auth/me`).
    phones = const [];
    await _store.saveSession(
      refreshToken: body['refreshToken'] as String,
      profile: const {},
    );
  }

  static List<Ecole> _ecolesDe(Object? brut) => brut is List
      ? brut.map((e) => Ecole.fromJson(e as Map<String, dynamic>)).toList(growable: false)
      : const [];

  /// Exchange the refresh token for a new pair.
  ///
  /// Rotation means the presented token is spent. If it is ever presented again
  /// the server revokes the whole family, so the stored copy must be replaced
  /// atomically with the new one — and no two callers may present it at once,
  /// which is what [_inFlight] is for.
  Future<bool> refresh() => _inFlight ??= _refreshOnce().whenComplete(() {
        _inFlight = null;
      });

  /// ⚠ UN SEUL PROCESSUS À LA FOIS présente le jeton : la tâche de fond
  /// (WorkManager, son propre isolat) et l'application ouverte le tenaient
  /// toutes deux — deux présentations du même jeton, et la famille entière
  /// était révoquée. Le verrou vit dans les préférences partagées (30 s).
  Future<bool> _refreshOnce() async {
    if (!await _prendreVerrouRefresh()) return false;
    try {
      return await _refreshSousVerrou();
    } finally {
      await _rendreVerrouRefresh();
    }
  }

  static const _cleVerrou = 'refresh_verrou';

  Future<bool> _prendreVerrouRefresh() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final maintenant = DateTime.now().millisecondsSinceEpoch;
      final tenu = prefs.getInt(_cleVerrou) ?? 0;
      if (maintenant - tenu < 30000) return false;
      await prefs.setInt(_cleVerrou, maintenant);
      return true;
    } catch (_) {
      // Pas de préférences (tests, plateforme sans greffon) : pas de verrou.
      return true;
    }
  }

  Future<void> _rendreVerrouRefresh() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cleVerrou);
    } catch (_) {}
  }

  Future<bool> _refreshSousVerrou() async {
    final stored = await _store.readRefreshToken();
    if (stored == null) return false;

    final http.Response response;
    try {
      response = await _http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': stored}),
      );
    } catch (_) {
      // No network. The credential is fine; the phone is on a bus.
      return false;
    }

    // 201 est un succès comme 200 : voir `login()`. Un 201 tombait ici, rendait
    // false sans déconnecter, et la session gardée ne se restaurait jamais —
    // l'écran de connexion à chaque ouverture, en silence.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      // ⚠ ONLY A REJECTION CLEARS IT. This used to call `logout()` on ANY
      // non-200, so a 500 or a 502 — a restart, a bad deploy, a proxy hiccup —
      // DELETED a ninety-day credential and sent the parent looking for the
      // password the school read out at the counter months ago. A server having
      // a bad minute is not a revoked session.
      // ⚠ 401 ou 403 SEULEMENT : le serveur a refusé CE jeton. Un 429 (le
      // plafond de requêtes, partagé par tout un opérateur derrière une même
      // adresse) ou un 400 passager effaçait la clé de 90 jours et renvoyait
      // la famille au mot de passe lu au guichet. Ils se traitent comme un 5xx.
      if (response.statusCode == 401 || response.statusCode == 403) {
        // ⚠ Sans `avantDeconnexion` : retirer le jeton de notification passe
        // par un DELETE qui, sur 401, attendrait CE rafraîchissement — un
        // interblocage qui figeait tous les écrans jusqu'à la fermeture. Le
        // serveur retire le jeton de lui-même ; la session, elle, est finie,
        // et la coquille en est prévenue.
        await _effacerSession();
        onSessionLost?.call();
      }
      return false;
    }

    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    _access = body['accessToken'] as String;
    ecoles = _ecolesDe(body['ecoles']);
    // Rotation spends the presented token, so the stored copy must be replaced
    // with the new one — presenting the old one again revokes the whole family.
    await _store.saveSession(
      refreshToken: body['refreshToken'] as String,
      profile: const {},
    );
    return true;
  }

  /// Change one's own password — `/auth/change-password`.
  ///
  /// The only thing a family may edit about their account. El Ourwa's seventh
  /// nav entry is called "Profil" and the page behind it is `changer_mdp.php`;
  /// there is nothing else on it.
  Future<void> changePassword(String current, String next, String confirm) async {
    // Son `changer_mdp.php` : la confirmation est jugée par le serveur, entre
    // le mot de passe actuel et la politique ; `espace: parent` choisit cet
    // ordre et ses phrases. Le jeton de rafraîchissement nomme la session à
    // garder — chez lui la session PHP du parent survit au changement.
    await post('/auth/change-password', {
      'currentPassword': current,
      'newPassword': next,
      'confirmPassword': confirm,
      'refreshToken': await _store.readRefreshToken(),
      'espace': 'parent',
    });
    // The gate is satisfied the moment the server accepts the change.
    mustChangePassword = false;
    // Le jeton d'accès porte le sceau de l'ancien mot de passe : un nouveau
    // tout de suite, sinon le prochain appel est refusé.
    await refresh();
  }

  /// Ce qui doit se faire AVANT que la session parte — retirer le jeton de
  /// notification demande encore le compte. Posé par `main.dart`, pour que ce
  /// fichier ne dépende pas de Firebase.
  Future<void> Function()? avantDeconnexion;

  /// Posé par `main.dart` : la coquille est prévenue quand le serveur a
  /// refusé la session (jeton révoqué ou expiré) — sinon elle restait
  /// affichée, chaque écran disant « le serveur ne répond pas ».
  void Function()? onSessionLost;

  Future<void> logout() async {
    try {
      await avantDeconnexion?.call();
    } catch (_) {
      // Rien n'empêche de se déconnecter.
    }
    // ⚠ RÉVOQUER AU SERVEUR, sinon le jeton de 90 jours survit à
    // « Se déconnecter » — un téléphone prêté ou vendu restait connecté.
    // Sans jeton d'accès (la route est publique), au mieux, sans bloquer.
    final jeton = await _store.readRefreshToken();
    if (jeton != null) {
      try {
        await _http.post(
          Uri.parse('$baseUrl/auth/logout'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'refreshToken': jeton}),
        );
      } catch (_) {}
    }
    await _effacerSession();
  }

  Future<void> _effacerSession() async {
    credentialGardee = false;
    _access = null;
    mustChangePassword = false;
    profileLocale = null;
    await _store.clear();
  }

  /// GET, retrying once through a token refresh on 401.
  /// How many messages the family has not opened — its header badge.
  Future<int> unreadCount() async {
    final r = await get('/parent/messages/unread');
    return (r['count'] as num?)?.toInt() ?? 0;
  }

  /// LE FLUX DE NOTIFICATIONS — the event stream, not the messagerie.
  ///
  /// ⚠ THE TABLE WAS WRITE-ONLY. Rows have been inserted since homework
  /// shipped — an exercise sent, a timetable published — and nothing in the
  /// system read one back: no endpoint, no screen, no badge. A school sent an
  /// exercise to thirty families and none of them were told.
  ///
  /// ⚠ AND MARK NOTIFICATIONS ARE WITHHELD SERVER-SIDE from a family in debt.
  /// The app must not try to be clever about that: it renders what it is given,
  /// and the count it is given already agrees with the list.
  Future<({List<ParentNotification> items, int unread})> notifications() async {
    final r = await get('/parent/notifications');
    final raw = (r['items'] as List<dynamic>? ?? const []);
    return (
      items: raw
          .map((e) => ParentNotification.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      unread: (r['unread'] as num?)?.toInt() ?? 0,
    );
  }

  Future<int> notificationsUnread() async {
    final r = await get('/parent/notifications/unread');
    return (r['count'] as num?)?.toInt() ?? 0;
  }

  Future<void> markNotificationRead(String id) =>
      post('/parent/notifications/$id/read', const {});

  Future<void> markAllNotificationsRead() =>
      post('/parent/notifications/read-all', const {});

  Future<Map<String, dynamic>> get(String path) async {
    var response = await _http.get(Uri.parse('$baseUrl$path'), headers: _headers());
    if (response.statusCode == 401 && await refresh()) {
      response = await _http.get(Uri.parse('$baseUrl$path'), headers: _headers());
    }
    if (response.statusCode != 200) {
      throw ApiException(_message(response), response.statusCode);
    }
    return jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  }

  /// LES OCTETS D'UNE PIÈCE JOINTE, avec le jeton.
  ///
  /// ⚠ UNE PIÈCE JOINTE NE PEUT PAS ÊTRE UNE SIMPLE URL. `/attachments/:id`
  /// vérifie que le demandeur est bien le parent d'un inscrit du groupe : la
  /// requête doit donc porter l'en-tête d'autorisation, ce qu'un `<img src>`
  /// ou un lien ouvert dans un onglet ne fait pas. On lit les octets ici et
  /// l'écran les affiche lui-même.
  Future<Uint8List> bytes(String path) async {
    var response = await _http.get(Uri.parse('$baseUrl$path'), headers: _headers());
    if (response.statusCode == 401 && await refresh()) {
      response = await _http.get(Uri.parse('$baseUrl$path'), headers: _headers());
    }
    if (response.statusCode != 200) {
      throw ApiException(_message(response), response.statusCode);
    }
    return response.bodyBytes;
  }

  /// POST, retrying once through a token refresh on 401 — the same contract as
  /// [get], because a 15-minute access token expires just as readily mid-write.
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final encoded = jsonEncode(body);
    var response = await _http.post(
      Uri.parse('$baseUrl$path'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: encoded,
    );
    if (response.statusCode == 401 && await refresh()) {
      response = await _http.post(
        Uri.parse('$baseUrl$path'),
        headers: {..._headers(), 'Content-Type': 'application/json'},
        body: encoded,
      );
    }
    if (response.statusCode != 200 && response.statusCode != 201) {
      throw ApiException(_message(response), response.statusCode);
    }
    if (response.bodyBytes.isEmpty) return const <String, dynamic>{};
    return jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  }

  /// Écrire le choix de langue au profil, comme `?lang=` écrit `parents.langue`
  /// chez El Ourwa. Silencieux si hors ligne : le choix est déjà gardé sur
  /// l'appareil, et le profil rattrapera au prochain passage.
  Future<void> setLocale(String code) async {
    if (!hasSession) return;
    try {
      await post('/auth/locale', {'locale': code});
      profileLocale = code;
    } catch (_) {
      // L'appareil garde le choix ; le profil suivra.
    }
  }

  /// DELETE avec corps — un seul usage : retirer le jeton de ce téléphone à la
  /// déconnexion. Même contrat que [post] pour le 401.
  Future<void> delete(String path, Map<String, dynamic> body) async {
    final encoded = jsonEncode(body);
    var response = await _http.delete(
      Uri.parse('$baseUrl$path'),
      headers: {..._headers(), 'Content-Type': 'application/json'},
      body: encoded,
    );
    if (response.statusCode == 401 && await refresh()) {
      response = await _http.delete(
        Uri.parse('$baseUrl$path'),
        headers: {..._headers(), 'Content-Type': 'application/json'},
        body: encoded,
      );
    }
    if (response.statusCode != 200 && response.statusCode != 204) {
      throw ApiException(_message(response), response.statusCode);
    }
  }


  String _message(http.Response response) {
    try {
      final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      final message = body['message'];
      if (message is String) return message;
      if (message is List) return message.join(', ');
    } catch (_) {
      /* fall through */
    }
    return 'Erreur ${response.statusCode}';
  }
}

/// Une école de la famille — l'application les étiquette sur chaque enfant.
class Ecole {
  const Ecole({required this.id, required this.slug, required this.name, this.nameAr});
  final String id;
  final String slug;
  final String name;
  final String? nameAr;

  factory Ecole.fromJson(Map<String, dynamic> json) => Ecole(
        id: json['id'] as String? ?? '',
        slug: json['slug'] as String,
        name: json['name'] as String,
        nameAr: json['nameAr'] as String? ?? json['name_ar'] as String?,
      );

  String libelle(bool arabe) => arabe && nameAr != null && nameAr!.isNotEmpty ? nameAr! : name;
}

class Child {
  const Child({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.groupName,
    this.levelName,
    this.isFree = false,
    this.absences = 0,
    this.average,
    this.examsWithheld = false,
    this.classRank = 0,
    this.school,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String? groupName;
  final String? levelName;
  final bool isFree;

  /// Its card's two figures.
  final int absences;

  /// ⚠ NULL WHEN THE FAMILY IS IN DEBT — the server withholds it rather than
  /// sending it for the app to hide. "Moyenne masquee en cas de dette : elle
  /// EST la note d'examen."
  final String? average;
  final bool examsWithheld;

  /// ⚠ SON « MATRICULE » — le rang de l'enfant dans sa classe, par ordre de nom.
  /// `enfant.php` l'affiche sous la classe, en `N°7`. C'est le numéro que la
  /// famille cite au secrétariat, et il ne figurait nulle part chez nous.
  final int classRank;
  /// L'école de cet enfant — une famille peut en avoir dans plusieurs.
  final Ecole? school;

  String get fullName => '$firstName $lastName'.trim();

  factory Child.fromJson(Map<String, dynamic> json) => Child(
        id: json['id'] as String,
        firstName: json['first_name'] as String,
        lastName: json['last_name'] as String,
        groupName: json['group_name'] as String?,
        levelName: json['level_name'] as String?,
        isFree: json['is_free'] as bool? ?? false,
        absences: (json['absences'] as num?)?.toInt() ?? 0,
        average: json['average'] as String?,
        examsWithheld: json['examsWithheld'] as bool? ?? false,
        classRank: (json['classRank'] as num?)?.toInt() ?? 0,
        school: json['school'] is Map<String, dynamic> ? Ecole.fromJson(json['school'] as Map<String, dynamic>) : null,
      );
}

class SubjectRow {
  const SubjectRow({
    required this.subject,
    required this.coefficient,
    required this.maxScore,
    this.coursework,
    this.exam,
    this.mark,
    this.markOutOf20,
    this.absent = false,
    this.courseworkMarks = const [],
    this.total,
  });
  /// Moyenne × coefficient — calculé par le serveur, jamais ici.
  final String? total;

  final String subject;
  final int coefficient;
  final String maxScore;
  /// Ses devoirs, un par un — la colonne « Devoirs » du bulletin.
  final List<String> courseworkMarks;
  /// Amounts and marks stay STRINGS end to end. Parsing to double would
  /// reintroduce exactly the precision loss the backend avoids.
  final String? coursework;
  final String? exam;
  final String? mark;
  final String? markOutOf20;
  final bool absent;

  factory SubjectRow.fromJson(Map<String, dynamic> json) => SubjectRow(
        subject: json['subject'] as String,
        coefficient: json['coefficient'] as int,
        maxScore: json['maxScore'] as String,
        coursework: json['coursework'] as String?,
        exam: json['exam'] as String?,
        mark: json['mark'] as String?,
        markOutOf20: json['markOutOf20'] as String?,
        absent: json['absent'] as bool? ?? false,
        courseworkMarks: ((json['courseworkMarks'] as List<dynamic>?) ?? const []).map((e) => '$e').toList(growable: false),
        total: json['total'] as String?,
      );
}

/// La décision d'admission telle que le bulletin l'imprime, dans les deux langues.
class Verdict {
  const Verdict({required this.status, required this.label, required this.labelAr});
  final String status;
  final String label;
  final String labelAr;
  factory Verdict.fromJson(Map<String, dynamic> json) => Verdict(
        status: json['status'] as String? ?? 'non_evalue',
        label: json['label'] as String? ?? '',
        labelAr: json['labelAr'] as String? ?? '',
      );
}

class ReportCard {
  const ReportCard({
    required this.regime,
    required this.term,
    required this.academicYear,
    required this.subjects,
    this.average,
    this.band,
    this.points,
    this.outOf,
    this.withheld = false,
    this.reason,
    this.student,
    this.formula,
    this.passMark = '10.00',
    this.termRecap = const [],
    this.termRecapFondamental = const [],
    this.annualAverage,
    this.annualFondamental,
    this.verdict,
    this.annualVerdict,
    this.totalCoefficients,
  });

  /// L'élève tel que le bulletin le nomme : matricule, classe, correspondant.
  final Map<String, dynamic>? student;
  /// La formule imprimée dans les en-têtes (× 2, × 3, ÷ 5).
  final Map<String, dynamic>? formula;
  final String passMark;
  final List<String?> termRecap;
  final List<Map<String, dynamic>?> termRecapFondamental;
  final String? annualAverage;
  final Map<String, dynamic>? annualFondamental;
  final Verdict? verdict;
  final Verdict? annualVerdict;
  final int? totalCoefficients;

  /// 'classic' produces an average out of 20; 'fondamental' produces a TOTAL
  /// out of the sum of the subjects' own scales. They are different documents.
  final String regime;
  final int term;
  final String academicYear;
  final List<SubjectRow> subjects;
  final String? average;
  final String? band;
  final String? points;
  final String? outOf;

  /// The school withholds EXAM results from families in debt, term by term
  /// (ADR-0015). The whole card is withheld, not its exam column: the average is
  /// computed from the exam mark, so a blanked column would still publish it.
  final bool withheld;
  final String? reason;

  bool get isFondamental => regime == 'fondamental';

  factory ReportCard.fromJson(Map<String, dynamic> json) => ReportCard(
        // Tolerant of a partial payload on purpose: a screen that throws tells
        // a family nothing, and they conclude the school has lost the marks.
        regime: json['regime'] as String? ?? 'classic',
        term: json['term'] as int? ?? 1,
        academicYear: json['academicYear'] as String? ?? '',
        withheld: json['withheld'] as bool? ?? false,
        reason: json['reason'] as String?,
        subjects: ((json['subjects'] as List<dynamic>?) ?? const [])
            .map((e) => SubjectRow.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        average: json['average'] as String?,
        band: json['band'] as String?,
        points: json['points'] as String?,
        outOf: json['outOf'] as String?,
        student: json['student'] as Map<String, dynamic>?,
        formula: json['formula'] as Map<String, dynamic>?,
        passMark: json['passMark'] as String? ?? '10.00',
        termRecap: ((json['termRecap'] as List<dynamic>?) ?? const []).map((e) => e == null ? null : '$e').toList(growable: false),
        termRecapFondamental: ((json['termRecapFondamental'] as List<dynamic>?) ?? const []).map((e) => e as Map<String, dynamic>?).toList(growable: false),
        annualAverage: json['annualAverage'] as String?,
        annualFondamental: json['annualFondamental'] as Map<String, dynamic>?,
        verdict: json['verdict'] is Map<String, dynamic> ? Verdict.fromJson(json['verdict'] as Map<String, dynamic>) : null,
        annualVerdict: json['annualVerdict'] is Map<String, dynamic> ? Verdict.fromJson(json['annualVerdict'] as Map<String, dynamic>) : null,
        totalCoefficients: (json['totalCoefficients'] as num?)?.toInt(),
      );
}

class ApiException implements Exception {
  const ApiException(this.message, this.statusCode);
  final String message;
  final int statusCode;

  @override
  String toString() => message;
}

/// One notification, as the API stores it.
///
/// ⚠ A KEY AND ITS PARAMETERS, NOT A SENTENCE. El Ourwa's own reason: "La clé
/// i18n permet d'afficher la notification dans la langue du parent (français OU
/// arabe)". A family reading Arabic must not be handed French because that was
/// the language of whoever pressed the button.
class ParentNotification {
  const ParentNotification({
    required this.id,
    required this.kind,
    required this.i18nKey,
    required this.params,
    required this.readAt,
    required this.createdAt,
  });

  factory ParentNotification.fromJson(Map<String, dynamic> json) => ParentNotification(
        id: json['id'] as String,
        kind: json['kind'] as String? ?? '',
        i18nKey: json['i18nKey'] as String? ?? '',
        params: (json['i18nParams'] as Map<String, dynamic>?) ?? const {},
        readAt: json['readAt'] == null
            ? null
            : DateTime.tryParse(json['readAt'] as String),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
      );

  final String id;
  final String kind;

  /// The STEM. The app resolves `<stem>_titre` and `<stem>_corps`.
  final String i18nKey;
  final Map<String, dynamic> params;
  final DateTime? readAt;
  final DateTime? createdAt;

  bool get unread => readAt == null;
}

/// Chaque requête abandonne après 20 secondes — un délai dépassé se traite
/// comme un réseau absent (l'appelant garde la session et réessaie).
class _ClientAvecDelai extends http.BaseClient {
  _ClientAvecDelai(this._inner);
  final http.Client _inner;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      _inner.send(request).timeout(const Duration(seconds: 20));

  @override
  void close() => _inner.close();
}
