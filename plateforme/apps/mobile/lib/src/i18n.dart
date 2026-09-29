/// El Ourwa's own translation table, extracted from `includes/i18n.php`.
///
/// Every string the parent space shows, in the school's own words rather than a
/// translation of mine. Two are worth noticing:
///
///   `identifiant` is "Telephone" — a family signs in with a phone number, not
///   an email, because a phone is what a family in Nouakchott has.
///
///   `app_nom` in Arabic is the school's name in Arabic, not a transliteration.
///
/// Generated from the reference. Edit there and re-extract, never here.
library;

import 'marque.dart';

const Map<String, Map<String, String>> kStrings = {
  // La marque de la construction (lib/src/marque.dart) — El Ourwa par défaut.
  'app_nom': {'fr': '{marque}', 'ar': '{marque}'},
  'bienvenue': {'fr': 'Bienvenue', 'ar': 'مرحبا'},
  'accueil': {'fr': 'Accueil', 'ar': 'الرئيسية'},
  'absences': {'fr': 'Absences', 'ar': 'الغيابات'},
  'resultats': {'fr': 'Résultats', 'ar': 'النتائج'},
  'remarques': {'fr': 'Remarques', 'ar': 'الملاحظات'},
  'exercices': {'fr': 'Exercices', 'ar': 'التمارين'},
  'messages': {'fr': 'Messages', 'ar': 'الرسائل'},
  'profil': {'fr': 'Profil', 'ar': 'الملف'},
  'plus': {'fr': 'Plus', 'ar': 'المزيد'},
  'deconnexion': {'fr': 'Déconnexion', 'ar': 'تسجيل الخروج'},
  // Profil → « Notifications » : chaque maillon de la chaîne se lit (23/09/2026).
  'notifs_titre': {'fr': 'Notifications', 'ar': 'الإشعارات'},
  'notifs_instantanees': {'fr': 'Notifications instantanées (Firebase)', 'ar': 'الإشعارات الفورية (Firebase)'},
  'notifs_compilees': {'fr': 'Intégrées à cette version', 'ar': 'مدمجة في هذا الإصدار'},
  'notifs_non_compilees': {'fr': 'Absentes de cette version : l’application interroge le serveur', 'ar': 'غير مدمجة في هذا الإصدار: التطبيق يستعلم من الخادم'},
  'notifs_jeton': {'fr': 'Ce téléphone est déclaré au serveur', 'ar': 'هذا الهاتف مسجّل لدى الخادم'},
  'notifs_jeton_absent': {'fr': 'Ce téléphone n’est pas encore déclaré au serveur', 'ar': 'هذا الهاتف غير مسجّل بعد لدى الخادم'},
  'notifs_jeton_erreur_permission': {'fr': 'Permission refusée : autorisez les notifications dans les réglages', 'ar': 'الإذن مرفوض: اسمح بالإشعارات في الإعدادات'},
  'notifs_jeton_erreur_reseau': {'fr': 'Le serveur n’a pas répondu ; nouvel essai automatique', 'ar': 'لم يستجب الخادم؛ سيُعاد المحاولة تلقائيا'},
  'notifs_jeton_erreur_firebase': {'fr': 'Services Google indisponibles sur ce téléphone', 'ar': 'خدمات Google غير متوفرة على هذا الهاتف'},
  'notifs_serveur_firebase': {'fr': 'Le serveur envoie par Firebase : arrivée en quelques secondes, application fermée', 'ar': 'الخادم يرسل عبر Firebase: تصل خلال ثوانٍ والتطبيق مغلق'},
  'notifs_serveur_sondage': {'fr': 'Le serveur n’a pas de clé Firebase : l’application interroge (15–30 s ouverte, 15 min fermée)', 'ar': 'الخادم بلا مفتاح Firebase: التطبيق يستعلم (15–30 ثانية مفتوحا، 15 دقيقة مغلقا)'},
  'notifs_serveur_inconnu': {'fr': 'État du serveur inconnu (hors ligne ?)', 'ar': 'حالة الخادم غير معروفة (بدون اتصال؟)'},
  'notifs_test_serveur': {'fr': 'Recevoir une notification de test du serveur', 'ar': 'استلام إشعار تجريبي من الخادم'},
  'notifs_test_envoyee': {'fr': 'Envoyée : elle doit arriver dans les secondes qui suivent, même application fermée.', 'ar': 'أُرسلت: يجب أن تصل خلال ثوانٍ، حتى والتطبيق مغلق.'},
  'notifs_test_sondage': {'fr': 'Mise en file, mais le serveur n’a pas de clé Firebase : elle ne partira que lorsqu’il en aura une.', 'ar': 'وُضعت في قائمة الانتظار، لكن الخادم بلا مفتاح Firebase: لن تُرسل حتى يحصل عليه.'},
  'notifs_test_aucun_appareil': {'fr': 'Le serveur ne connaît aucun téléphone pour ce compte : rien n’arrivera tant que ce téléphone n’est pas déclaré (voir la ligne ci-dessus).', 'ar': 'الخادم لا يعرف أي هاتف لهذا الحساب: لن يصل شيء حتى يُسجَّل هذا الهاتف (انظر السطر أعلاه).'},
  'bulletin_erreur': {'fr': 'Le bulletin n’a pas pu être généré sur ce téléphone.', 'ar': 'تعذر إنشاء كشف النقاط على هذا الهاتف.'},
  'numeros_compte': {'fr': 'Numéros qui ouvrent ce compte', 'ar': 'الأرقام التي تفتح هذا الحساب'},
  'bulletin_enregistre': {'fr': 'Bulletin enregistré dans Téléchargements.', 'ar': 'تم حفظ كشف النقاط في التنزيلات.'},
  'bulletin_ouvert': {'fr': 'Bulletin ouvert : enregistrez-le ou partagez-le depuis le lecteur.', 'ar': 'تم فتح كشف النقاط: احفظه أو شاركه من القارئ.'},
  'bulletin_partage': {'fr': 'Aucun lecteur PDF : le bulletin est proposé au partage.', 'ar': 'لا يوجد قارئ PDF: كشف النقاط معروض للمشاركة.'},
  'examens_bloques_ecoles': {'fr': 'Concerne : {ecoles}', 'ar': 'يخص: {ecoles}'},
  'tester_sonnerie': {'fr': 'Tester la sonnerie et la vibration', 'ar': 'اختبار الرنين والاهتزاز'},
  'sonnerie_test_titre': {'fr': 'Test de notification', 'ar': 'اختبار الإشعار'},
  'sonnerie_test_corps': {'fr': 'Si vous entendez ce son et sentez la vibration, tout est en place.', 'ar': 'إذا سمعت هذا الصوت وشعرت بالاهتزاز فكل شيء جاهز.'},
  'notifications_refusees': {'fr': 'Notifications refusées par le téléphone : autorisez-les dans les réglages de l’application.', 'ar': 'الإشعارات مرفوضة من الهاتف: اسمح بها في إعدادات التطبيق.'},
  'notifications_autorisees': {'fr': 'Notifications autorisées', 'ar': 'الإشعارات مسموح بها'},
  'version_serveur': {'fr': 'Version {version} · serveur {serveur}', 'ar': 'الإصدار {version} · الخادم {serveur}'},
  'connexion': {'fr': 'Connexion', 'ar': 'تسجيل الدخول'},
  'se_connecter': {'fr': 'Se connecter', 'ar': 'دخول'},
  'identifiant': {'fr': 'Téléphone', 'ar': 'الهاتف'},
  'mot_de_passe': {'fr': 'Mot de passe', 'ar': 'كلمة المرور'},
  'envoyer': {'fr': 'Envoyer', 'ar': 'إرسال'},
  'annuler': {'fr': 'Annuler', 'ar': 'إلغاء'},
  'fermer': {'fr': 'Fermer', 'ar': 'إغلاق'},
  'enregistrer': {'fr': 'Enregistrer', 'ar': 'حفظ'},
  'modifier': {'fr': 'Modifier', 'ar': 'تعديل'},
  'voir': {'fr': 'Voir', 'ar': 'عرض'},
  'voir_details': {'fr': 'Voir détails', 'ar': 'عرض التفاصيل'},
  'aucun_resultat': {'fr': 'Aucun résultat', 'ar': 'لا توجد نتائج'},
  'chargement': {'fr': 'Chargement…', 'ar': 'جار التحميل…'},
  'oui': {'fr': 'Oui', 'ar': 'نعم'},
  'non': {'fr': 'Non', 'ar': 'لا'},
  'titre_connexion_parent': {'fr': 'Espace correspondant', 'ar': 'فضاء ولي الأمر'},
  'sous_titre_connexion': {'fr': 'Connectez-vous pour suivre votre enfant', 'ar': 'سجّل الدخول لمتابعة أبنائك'},
  'erreur_identifiants': {'fr': 'Identifiants incorrects.', 'ar': 'بيانات الاعتماد غير صحيحة.'},
  // La règle de l'identifiant (décision du propriétaire, 2026-09-14) : la même phrase que l'API.
  'telephone_mauritanien_refus': {
    'fr': 'Numéro mauritanien attendu : 8 chiffres commençant par 2, 3 ou 4 (indicatif +222 facultatif).',
    'ar': 'يُرجى إدخال رقم موريتاني: 8 أرقام تبدأ بـ 2 أو 3 أو 4 (الرمز +222 اختياري).',
  },
  // Son `requeteAjax()` (assets/js/app.js), en français seul chez lui aussi.
  'erreur_reseau': {'fr': 'Erreur de communication avec le serveur.', 'ar': 'خطأ في الاتصال بالخادم.'},
  'mdp_oublie': {'fr': 'Mot de passe oublié ?', 'ar': 'نسيت كلمة المرور؟'},
  'tout_correspondant_doit_changer': {'fr': 'Vous devez changer votre mot de passe avant de continuer.', 'ar': 'يجب تغيير كلمة المرور قبل المتابعة.'},
  'hero_titre_l1': {'fr': 'Suivez la scolarité', 'ar': 'تابع مسار طفلك المدرسي'},
  'hero_titre_l2': {'fr': 'de votre enfant en temps réel.', 'ar': 'في الوقت الفعلي.'},
  'hero_lede': {'fr': 'Notes, absences, exercices, messages des enseignants — tout au même endroit, immédiatement.', 'ar': 'النقاط، الغيابات، التمارين، رسائل الأساتذة — كل شيء في مكان واحد، فوراً.'},
  'feat_notif': {'fr': 'Notifications instantanées dans votre navigateur', 'ar': 'إشعارات فورية في متصفحك'},
  'feat_classe': {'fr': 'Toute la classe de votre enfant, accessible en un clic', 'ar': 'كل تفاصيل صف ابنك بنقرة واحدة'},
  'feat_secu': {'fr': 'Connexion sécurisée par téléphone & mot de passe', 'ar': 'تسجيل دخول آمن بالهاتف وكلمة المرور'},
  'footer_copyright': {'fr': '© 2026 {marque} — Tous droits réservés.', 'ar': '© 2026 {marque} — جميع الحقوق محفوظة.'},
  'bonjour': {'fr': 'Bonjour', 'ar': 'مرحباً'},
  'connectez_vous': {'fr': 'Connectez-vous avec le numéro de téléphone communiqué par l\'école.', 'ar': 'سجّل الدخول برقم الهاتف الذي قدّمته المدرسة.'},
  'acces_admin': {'fr': 'Accès personnel & administration', 'ar': 'دخول الموظفين والإدارة'},
  'mes_enfants': {'fr': 'Mes enfants', 'ar': 'أبنائي'},
  'mon_enfant': {'fr': 'Mon enfant', 'ar': 'ابني'},
  'classe': {'fr': 'Classe', 'ar': 'الصف'},
  'niveau': {'fr': 'Niveau', 'ar': 'المستوى'},
  'groupe': {'fr': 'Groupe', 'ar': 'المجموعة'},
  'matieres': {'fr': 'Matières', 'ar': 'المواد'},
  'matiere': {'fr': 'Matière', 'ar': 'المادة'},
  'professeur': {'fr': 'Professeur', 'ar': 'الأستاذ'},
  'note': {'fr': 'Note', 'ar': 'النقطة'},
  'moyenne': {'fr': 'Moyenne', 'ar': 'المعدل'},
  'trimestre': {'fr': 'Trimestre', 'ar': 'الفصل'},
  'annee_scolaire': {'fr': 'Année scolaire', 'ar': 'السنة الدراسية'},
  'bulletin': {'fr': 'Bulletin', 'ar': 'كشف النقاط'},
  'voir_bulletin': {'fr': 'Voir le bulletin', 'ar': 'عرض كشف النقاط'},
  'emploi_du_temps': {'fr': 'Emploi du temps', 'ar': 'جدول الحصص'},
  'mon_emploi_temps': {'fr': 'Mon emploi du temps', 'ar': 'جدولي الزمني'},
  'totalabsences': {'fr': 'Total absences', 'ar': 'مجموع الغيابات'},
  'date': {'fr': 'Date', 'ar': 'التاريخ'},
  'motif': {'fr': 'Motif', 'ar': 'السبب'},
  'lundi': {'fr': 'Lundi', 'ar': 'الإثنين'},
  'mardi': {'fr': 'Mardi', 'ar': 'الثلاثاء'},
  'mercredi': {'fr': 'Mercredi', 'ar': 'الأربعاء'},
  'jeudi': {'fr': 'Jeudi', 'ar': 'الخميس'},
  'vendredi': {'fr': 'Vendredi', 'ar': 'الجمعة'},
  'samedi': {'fr': 'Samedi', 'ar': 'السبت'},
  'notifications': {'fr': 'Notifications', 'ar': 'الإشعارات'},
  'nouvelle_notification': {'fr': 'Vous avez une nouvelle notification.', 'ar': 'لديك إشعار جديد.'},
  'nouveau_message_corps': {'fr': 'Vous avez un nouveau message de l’école.', 'ar': 'لديك رسالة جديدة من المدرسة.'},
  'nouveaux_messages': {'fr': 'Vous avez {n} nouveaux messages de l’école.', 'ar': 'لديك {n} رسائل جديدة من المدرسة.'},
  'nouvelles_notifications': {'fr': 'Vous avez {n} nouvelles notifications.', 'ar': 'لديك {n} إشعارات جديدة.'},
  'aucune_notif': {'fr': 'Aucune notification.', 'ar': 'لا توجد إشعارات.'},
  'tout_marquer_lu': {'fr': 'Tout marquer comme lu', 'ar': 'تحديد الكل كمقروء'},
  'nouvelle_notif': {'fr': 'Nouvelle notification', 'ar': 'إشعار جديد'},
  'nouveau_message': {'fr': 'Nouveau message', 'ar': 'رسالة جديدة'},
  'expediteur': {'fr': 'Expéditeur', 'ar': 'المُرسِل'},
  'sujet': {'fr': 'Sujet', 'ar': 'الموضوع'},
  'aucun_message': {'fr': 'Aucun message.', 'ar': 'لا توجد رسائل.'},
  'fiche_enfant': {'fr': 'Fiche de l\'enfant', 'ar': 'بطاقة الابن'},
  'matricule': {'fr': 'Matricule', 'ar': 'الرقم التعريفي'},
  // Le bouton de la fiche d'un enfant : « 📄 Bulletin officiel (imprimable) ».
  // L'onglet Bulletin donne les moyennes ; celui-ci ouvre la pièce que l'école
  // signe. Les deux existent dans `enfant.php`, et c'est délibéré.
  'bulletin_officiel': {'fr': 'Bulletin officiel', 'ar': 'كشف النقاط الرسمي'},
  // Le bouton sous le document : le PDF, tiré du même HTML que le site.
  'telecharger_bulletin': {'fr': 'Télécharger le bulletin (PDF)', 'ar': 'تنزيل كشف النقاط (PDF)'},
  'frais_mensuel': {'fr': 'Frais mensuels', 'ar': 'المصاريف الشهرية'},
  'liste_remarques': {'fr': 'Remarques des professeurs', 'ar': 'ملاحظات الأساتذة'},
  'aucune_remarque': {'fr': 'Aucune remarque.', 'ar': 'لا توجد ملاحظات.'},
  'aucune_absence': {'fr': 'Aucune absence enregistrée.', 'ar': 'لا توجد غيابات مسجلة.'},
  'choisir_trimestre': {'fr': 'Choisir le trimestre', 'ar': 'اختر الفصل'},
  'tous_trimestres': {'fr': 'Tous les trimestres', 'ar': 'كل الفصول'},
  'trimestre_1': {'fr': 'Trimestre 1', 'ar': 'الفصل الأول'},
  'trimestre_2': {'fr': 'Trimestre 2', 'ar': 'الفصل الثاني'},
  'trimestre_3': {'fr': 'Trimestre 3', 'ar': 'الفصل الثالث'},
  'changer_mdp': {'fr': 'Changer mon mot de passe', 'ar': 'تغيير كلمة المرور'},
  'mdp_actuel': {'fr': 'Mot de passe actuel', 'ar': 'كلمة المرور الحالية'},
  'nouveau_mdp': {'fr': 'Nouveau mot de passe', 'ar': 'كلمة المرور الجديدة'},
  'confirmer_mdp': {'fr': 'Confirmer le mot de passe', 'ar': 'تأكيد كلمة المرور'},
  'langue': {'fr': 'Langue', 'ar': 'اللغة'},
  'francais': {'fr': 'Français', 'ar': 'الفرنسية'},
  'arabe': {'fr': 'العربية', 'ar': 'العربية'},
  'erreur_generique': {'fr': 'Une erreur est survenue.', 'ar': 'حدث خطأ.'},
  'champs_requis': {'fr': 'Veuillez remplir tous les champs requis.', 'ar': 'يرجى ملء جميع الحقول المطلوبة.'},
  'apercu_enfants': {'fr': 'Voici un aperçu de la scolarité de vos enfants.', 'ar': 'إليك نظرة على المسار الدراسي لأبنائك.'},
  'apercu_enfant': {'fr': 'Voici un aperçu de la scolarité de votre enfant.', 'ar': 'إليك نظرة على المسار الدراسي لابنك.'},
  'aucun_enfant': {'fr': 'Aucun enfant rattaché', 'ar': 'لا يوجد ابن مرتبط بحسابك'},
  'contactez_etablissement': {'fr': 'Contactez l\'établissement pour qu\'un étudiant soit associé à votre compte.', 'ar': 'يرجى الاتصال بالمدرسة لربط ابنك بحسابك.'},
  'mes_notes': {'fr': 'Mes notes', 'ar': 'نقاطي'},
  'aucune_note': {'fr': 'Aucune note pour le moment.', 'ar': 'لا توجد نقاط حالياً.'},
  'type_note': {'fr': 'Type', 'ar': 'النوع'},
  'devoir': {'fr': 'Devoir', 'ar': 'فرض'},
  'controle': {'fr': 'Contrôle', 'ar': 'اختبار'},
  'examen': {'fr': 'Examen', 'ar': 'امتحان'},
  'mes_exercices': {'fr': 'Mes exercices', 'ar': 'تماريني'},
  'aucun_exercice': {'fr': 'Aucun exercice pour le moment.', 'ar': 'لا توجد تمارين حالياً.'},
  'a_rendre': {'fr': 'À rendre', 'ar': 'تسليم قبل'},
  'consigne': {'fr': 'Consigne', 'ar': 'التعليمات'},
  'piece_jointe': {'fr': 'Pièce jointe', 'ar': 'الملف المرفق'},
  'telecharger': {'fr': 'Télécharger', 'ar': 'تحميل'},
  'mes_messages': {'fr': 'Mes messages', 'ar': 'رسائلي'},
  'de_la_part_de': {'fr': 'De la part de', 'ar': 'من'},
  'lu': {'fr': 'Lu', 'ar': 'مقروء'},
  'non_lu': {'fr': 'Non lu', 'ar': 'غير مقروء'},
  'changement_obligatoire': {'fr': 'Vous devez changer votre mot de passe avant de continuer.', 'ar': 'يجب عليك تغيير كلمة المرور قبل المتابعة.'},
  'mdp_change_succes': {'fr': 'Mot de passe modifié avec succès.', 'ar': 'تم تغيير كلمة المرور بنجاح.'},
  // ⚠ Les magasins exigent la suppression du compte DANS l'application, et un
  // lien vers la politique de confidentialité. Ces clés ne viennent pas
  // d'El Ourwa, qui n'était pas publié en magasin.
  'confidentialite': {'fr': 'Politique de confidentialité', 'ar': 'سياسة الخصوصية'},
  'conditions': {'fr': 'Conditions d’utilisation', 'ar': 'شروط الاستخدام'},
  'supprimer_compte': {'fr': 'Supprimer mon compte', 'ar': 'حذف حسابي'},
  'supprimer_compte_explication': {
    'fr': 'Votre nom, votre numéro et votre identifiant seront effacés, votre compte fermé et tous vos appareils déconnectés. Les écritures scolaires et comptables concernant vos enfants sont conservées par l’école, sous un compte anonyme, comme la loi l’y oblige. Cette action est irréversible.',
    'ar': 'سيُمحى اسمكم ورقمكم ومعرّفكم، ويُغلق حسابكم، وتُفصل كل أجهزتكم. تحتفظ المدرسة بالقيود المدرسية والمحاسبية المتعلقة بأبنائكم تحت حساب مجهول كما يلزمها القانون. هذا الإجراء لا رجعة فيه.',
  },
  'supprimer_compte_confirmer': {'fr': 'Saisissez votre mot de passe pour confirmer', 'ar': 'أدخلوا كلمة المرور للتأكيد'},
  'supprimer_definitivement': {'fr': 'Supprimer définitivement', 'ar': 'حذف نهائي'},
  'compte_supprime': {'fr': 'Votre compte a été supprimé.', 'ar': 'تم حذف حسابكم.'},
  'notes_short': {'fr': 'Notes', 'ar': 'النقاط'},
  'exos_short': {'fr': 'Exos', 'ar': 'التمارين'},
  'notif_absence_titre': {'fr': 'Absence signalée', 'ar': 'تسجيل غياب'},
  'notif_absence_corps': {'fr': '{eleve} a été marqué(e) absent(e) le {date}.', 'ar': 'تم تسجيل غياب {eleve} بتاريخ {date}.'},
  'notif_retard_titre': {'fr': 'Retard signalé', 'ar': 'تسجيل تأخر'},
  'notif_retard_corps': {'fr': '{eleve} est arrivé(e) en retard le {date}.', 'ar': 'وصل(ت) {eleve} متأخرا بتاريخ {date}.'},
  'notif_note_titre': {'fr': 'Nouvelle note : {matiere}', 'ar': 'نقطة جديدة : {matiere}'},
  'notif_note_corps': {'fr': '{eleve} a obtenu {note} en {matiere} ({trimestre}).', 'ar': 'تحصل(ت) {eleve} على {note} في مادة {matiere} ({trimestre}).'},
  'notif_exercice_titre': {'fr': 'Nouvel exercice : {matiere}', 'ar': 'تمرين جديد : {matiere}'},
  'notif_exercice_corps': {'fr': 'Exercice « {titre} » pour {eleve}.{limite}', 'ar': 'تمرين « {titre} » لـ {eleve}.{limite}'},
  'notif_remarque_titre': {'fr': 'Remarque du professeur', 'ar': 'ملاحظة من الأستاذ'},
  'notif_remarque_corps': {'fr': 'Une remarque a été ajoutée pour {eleve}.', 'ar': 'تمت إضافة ملاحظة بخصوص {eleve}.'},
  'notif_message_titre': {'fr': 'Nouveau message : {sujet}', 'ar': 'رسالة جديدة : {sujet}'},
  'notif_message_corps': {'fr': '{contenu}', 'ar': '{contenu}'},
  'notif_paiement_titre': {'fr': 'Paiement enregistré', 'ar': 'تم تسجيل الدفع'},
  'notif_paiement_corps': {'fr': 'Paiement de {montant} MRU enregistré pour {eleve}.', 'ar': 'تم تسجيل دفعة بقيمة {montant} أوقية لـ {eleve}.'},
  'notif_rappel_titre': {'fr': 'Rappel de paiement', 'ar': 'تذكير بالدفع'},
  'notif_rappel_corps': {'fr': "Le paiement de {eleve} pour {mois} n'a pas encore été enregistré. Merci de régulariser.", 'ar': 'لم يتم تسجيل دفع {eleve} لشهر {mois} بعد. يرجى التسوية.'},
  'notif_inscription_titre': {'fr': 'Nouvelle inscription', 'ar': 'تسجيل جديد'},
  'notif_inscription_corps': {'fr': '{eleve} a été inscrit(e) en {groupe}.', 'ar': 'تم تسجيل {eleve} في {groupe}.'},
  'notif_reinscription_titre': {'fr': 'Réinscription', 'ar': 'إعادة التسجيل'},
  'notif_reinscription_corps': {'fr': '{eleve} a été réinscrit(e) en {groupe}.', 'ar': 'تمت إعادة تسجيل {eleve} في {groupe}.'},
  'notif_emploi_titre': {'fr': 'Emploi du temps publié', 'ar': 'تم نشر جدول الحصص'},
  // Its own sentence, and the second half is the useful half: it says where
  // to go and look.
  'notif_emploi_corps': {
    'fr': "L'emploi du temps de la classe {groupe} a été publié. Consultez le profil de votre enfant pour le voir.",
    'ar': 'تم نشر جدول الحصص للقسم {groupe}. اطلع على ملف ابنك (ابنتك) للاطلاع عليه.',
  },
  'notif_test_titre': {'fr': 'Test de notification', 'ar': 'اختبار الإشعار'},
  'notif_test_corps': {
    'fr': 'Si vous voyez ceci, les notifications instantanées fonctionnent sur ce téléphone.',
    'ar': 'إذا رأيت هذا، فالإشعارات الفورية تعمل على هذا الهاتف.',
  },
  // Inline in `exercices.php`. ⚠ Two different sentences, not one with a
  // colour: "à rendre" is an instruction, "date dépassée" is news.
  'a_rendre_avant': {'fr': 'À rendre avant le', 'ar': 'تسليم قبل'},
  'date_depassee': {'fr': 'Date dépassée —', 'ar': 'انقضى الأجل —'},

  'exercices_sous_titre': {
    'fr': 'Tous les devoirs et exercices donnés par les enseignants.',
    'ar': 'جميع التمارين الموكلة من قبل الأساتذة.',
  },
  'historique_absences': {'fr': 'Historique des absences', 'ar': 'سجل الغيابات'},
  // Inline in `changer_mdp.php` — its heading and lede, both languages.
  'securite': {'fr': 'Sécurité', 'ar': 'الأمان'},
  'securite_sous_titre': {
    'fr': 'Changez régulièrement votre mot de passe pour protéger votre compte.',
    'ar': 'غيّر كلمة المرور بانتظام لحماية حسابك.',
  },
  // ⚠ Ours, not theirs: their policy message only appears AFTER a rejection.
  // Saying it first spares a parent one refusal, and it is the same sentence
  // the server would answer with.
  'regle_mdp': {
    'fr': 'Au moins 8 caractères, combinant au moins 3 types parmi : minuscules, majuscules, chiffres, symboles.',
    'ar': '٨ أحرف على الأقل، تجمع ٣ أنواع على الأقل من: أحرف صغيرة، كبيرة، أرقام، رموز.',
  },
  'aucun_cours': {
    'fr': 'Aucun cours à l’emploi du temps de cette classe.',
    'ar': 'لا توجد حصص في جدول هذا القسم.',
  },
  'non_justifiee': {'fr': 'Non justifiée', 'ar': 'غير مبرر'},
  'statut': {'fr': 'Statut', 'ar': 'الحالة'},
  'justifiee': {'fr': 'Justifiée', 'ar': 'مبرر'},
  'absent': {'fr': 'Absent', 'ar': 'غائب'},
  'retard': {'fr': 'Retard', 'ar': 'متأخر'},

  // Inline in `resultats.php` rather than in its table, both languages.
  'resultats_sous_titre': {
    'fr': 'Toutes les notes saisies par les enseignants, du plus récent au plus ancien.',
    'ar': 'جميع النقاط المسجلة من قبل الأساتذة، من الأحدث إلى الأقدم.',
  },

  // ⚠ `parent_avis_examens_bloques()`, verbatim. Note what it does NOT say:
  // no sum, no arrears figure, no accusation. It says the results are
  // "momentanément" unavailable and tells the family where to go. The school
  // withholds; it does not dun.
  'examens_bloques_titre': {
    'fr': 'Résultats d’examen momentanément indisponibles',
    'ar': 'نتائج الامتحانات غير متاحة حالياً',
  },
  'examens_bloques_texte': {
    'fr': 'Les notes d’examen et les moyennes s’affichent une fois la situation financière régularisée. Rapprochez-vous du secrétariat de l’école.',
    'ar': 'تظهر نتائج الامتحانات والمعدلات بعد تسوية المستحقات. يرجى التقرب من إدارة المدرسة.',
  },

  // ⚠ ITS EMPTY STATE FOR THE GAP BETWEEN TWO SCHOOL YEARS, from
  // `parent_etat_sans_annee()`. This is what a family sees instead of last
  // year's marks, and it is a promise rather than an apology: the information
  // comes BACK — "réapparaîtront" — when the new year opens.
  'sans_annee_titre': {
    'fr': 'Aucune année scolaire active',
    'ar': 'لا توجد سنة دراسية نشطة',
  },
  'sans_annee_texte': {
    'fr': 'Les informations de vos enfants réapparaîtront dès l’ouverture de la nouvelle année scolaire.',
    'ar': 'ستظهر معلومات أبنائكم فور فتح السنة الدراسية الجديدة.',
  },
  // ⚠ NOT El Ourwa's — it has one school and never asks which. Multi-tenancy
  // makes the question real for us, so the string is ours and says so here
  // rather than pretending to be extracted.
  'ecole': {'fr': 'École', 'ar': 'المدرسة'},
};

/// Look one up.
///
/// Falls back to French, then to the key itself. A missing string then shows as
/// `absences` rather than as a blank space, which is visible in testing and
/// harmless in front of a parent.
String t(String key, String lang) =>
    (kStrings[key]?[lang] ?? kStrings[key]?['fr'] ?? key)
        // Le nom de la marque, dans la langue de l'écran.
        .replaceAll('{marque}', Marque.selon(lang));

/// Fill `{placeholders}` from a notification's stored parameters.
///
/// ⚠ AN UNKNOWN PLACEHOLDER IS LEFT ALONE, NOT BLANKED. "{eleve} a été marqué(e)
/// absent(e)" with no `eleve` reads as " a été marqué(e) absent(e)" — a sentence
/// about nobody, which a parent will read as being about their child anyway.
/// Leaving `{eleve}` visible is ugly and honest, and shows up the day a sender
/// forgets a parameter instead of six months later.
String fill(String template, Map<String, dynamic> params) {
  var out = template;
  params.forEach((k, v) {
    out = out.replaceAll('{$k}', '${v ?? ''}');
  });
  return out;
}

/// The title and body of one notification, in the parent's language.
///
/// ⚠ THE KEY STORED IS A STEM. The API writes `notif_exercice`; the strings are
/// `notif_exercice_titre` and `notif_exercice_corps`. One convention, one table
/// — the alternative was a second mapping between two naming schemes, which is
/// a thing that drifts.
///
/// A stem with no strings falls back to the stem itself rather than to an empty
/// card: a notification nobody can read is still evidence that something
/// happened, and a blank one is not.
({String titre, String corps}) notificationTexte(
  String stem,
  Map<String, dynamic> params,
  String lang,
) {
  final titre = t('${stem}_titre', lang);
  final corps = t('${stem}_corps', lang);
  return (
    titre: fill(titre == '${stem}_titre' ? stem : titre, params),
    corps: fill(corps == '${stem}_corps' ? '' : corps, params),
  );
}
