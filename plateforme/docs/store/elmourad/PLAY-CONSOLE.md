# El Mourad — publier sur Google Play (compte PERSONNEL)

Tout ce qu'il faut saisir dans la Play Console, dans l'ordre. Les visuels sont à
côté de ce fichier : `icone-512.png`, `graphique-1024x500.png` (et le logo dans
`deploy/brands/elmourad/logo/`).

## 1. Construire le .aab (PC de construction, Git Bash) — UNE fois la préparation

    flutter upgrade                              # Flutter ≥ 3.35 : Android 16 (API 36)
    tools/android-sdk.sh                         # plateforme android-36, build-tools 35 et 36
    BRAND=elmourad tools/packager.sh cle         # la clé de téléversement d'El Mourad

⚠ `apps/mobile/android/key-elmourad.properties` et `elmourad-upload.jks` :
**copiez-les hors du PC (clé USB + un second support)**. Sans eux, plus aucune
mise à jour ne peut être envoyée sans demander à Google une nouvelle clé.

À chaque version :

    BRAND=elmourad tools/packager.sh android     # dist/elmourad-parent-<version>.aab, vérifié
    BRAND=elmourad tools/packager.sh apk         # dist/elmourad-parent-<version>.apk (essais)

Le `.aab` compile `https://api.elmouradarafat.cloud` (deploy/brands/elmourad.env) ;
`packager.sh android` refuse de le livrer s'il manque, ou si une permission
photos/vidéos, l'identifiant publicitaire ou le mode débogage s'y trouvent.
Le paquet cible Android 16 (API 36), exigé depuis le 31 août 2026.

## 2. Le compte développeur personnel

play.google.com/console → compte **personnel** → 25 $ → vérification d'identité
(pièce d'identité), du téléphone, et de l'accès à un appareil Android.

⚠ Un compte personnel récent doit faire tourner un **test fermé avec au moins
12 testeurs inscrits pendant 14 jours d'affilée** avant de pouvoir publier en
production. Recrutez-les maintenant : personnel de l'école et parents volontaires,
chacun avec un compte Google et un téléphone Android.

## 3. Créer l'application

Nom `El Mourad – Espace parents` · langue par défaut Français (fr-FR) ·
Application · Gratuite. Signature d'application Play : **accepter le choix par
défaut** (Google garde la clé de signature ; vous téléversez avec la vôtre).

## 4. Contenu de l'application (App content)

| Rubrique | Réponse |
|---|---|
| Règles de confidentialité | https://elmouradarafat.cloud/legal/confidentialite |
| Accès à l'application | « Tout ou partie de l'app est restreinte » → le compte de démonstration (§ 6) |
| Annonces | Non, pas de publicité |
| Classification du contenu | Catégorie « Référence, actualités ou éducation » ; violence, sexe, langage, drogues, jeux d'argent : Non ; échanges entre utilisateurs : **Non** (les parents lisent les messages de l'école, n'en envoient pas) ; partage de position : Non ; achats numériques : Non |
| Public cible | **18 ans et plus uniquement** (l'application sert les parents) ; « attire les enfants » : Non |
| Identifiant publicitaire | Non (aucune permission AD_ID) |
| Applis gouvernementales | Non |
| Fonctionnalités financières | Aucune (l'application affiche les paiements, elle n'en encaisse pas) |
| Santé | Non |
| Sécurité des données | Voir `docs/legal/declarations-magasins.md` : nom, téléphone, e-mail facultatif (infos personnelles) ; notes, absences, remarques, paiements (données de l'élève et financières) ; jeton de notification (identifiant d'appareil). Chiffrées en transit : Oui. Suppression possible : Oui. Aucune vente, aucune publicité. |
| Suppression de compte (URL) | https://elmouradarafat.cloud/legal/suppression — le compte est créé par l'école, la suppression existe aussi dans l'application (Profil → Supprimer mon compte) |

## 5. Fiche du Play Store

Catégorie **Éducation** · site https://elmouradarafat.cloud · adresse e-mail de
contact : **une adresse réelle que vous consultez** (pas admin@supnum.mr, fictive) ·
téléphone +222 27 08 89 99. Icône : `icone-512.png`. Image de présentation :
`graphique-1024x500.png`. Captures : au moins 2 (idéalement 4 à 8) captures du
téléphone, en 9:16, prises dans l'application avec le compte de démonstration.

### Français (fr-FR)

**Nom** (30 max) : El Mourad – Espace parents

**Description courte** (80 max) :
Notes, absences, devoirs, messages et reçus de vos enfants, en temps réel.

**Description complète** :

El Mourad – Espace parents est l'application officielle du Complexe écoles privées Elmourad, à Nouakchott. Elle réunit, pour les parents et les tuteurs, tout ce que l'école publie sur leurs enfants.

Ce que vous y trouvez :
• Les notes de chaque évaluation, et les bulletins à télécharger en PDF
• Les absences, dès qu'elles sont saisies
• Les exercices et devoirs donnés en classe
• Les remarques des enseignants
• L'emploi du temps de la classe
• Les messages de l'école
• Vos paiements et vos reçus, avec ce qui reste à régler

Des notifications vous préviennent dès qu'une note, une absence, un exercice, un message ou un paiement est enregistré. Par discrétion, une note ne s'affiche jamais sur l'écran verrouillé : elle se lit dans l'application.

L'application est en français et en arabe.

Votre compte est créé par l'école : votre identifiant et votre mot de passe provisoire vous sont remis au secrétariat. Il n'y a pas d'inscription dans l'application. Vous pouvez supprimer votre compte à tout moment (Profil → Supprimer mon compte).

Aucune publicité. Vos données ne sont ni vendues ni partagées à des fins commerciales.

### العربية (ar)

**الاسم**: المراد – فضاء الأولياء

**الوصف القصير**:
نقاط أبنائكم وغياباتهم وواجباتهم ورسائل المدرسة وإيصالاتكم، أولًا بأول.

**الوصف الكامل**:

«المراد – فضاء الأولياء» هو التطبيق الرسمي لـ Complexe écoles privées Elmourad في نواكشوط. يجمع للآباء والأوصياء كل ما تنشره المدرسة عن أبنائهم.

ما تجدونه فيه:
• نقاط كل تقييم، وكشوف النقاط للتحميل بصيغة PDF
• الغيابات فور تسجيلها
• التمارين والواجبات المعطاة في القسم
• ملاحظات الأساتذة
• جدول حصص القسم
• رسائل المدرسة
• مدفوعاتكم وإيصالاتكم، وما بقي عليكم تسديده

تنبّهكم الإشعارات فور تسجيل نقطة أو غياب أو تمرين أو رسالة أو دفع. وحفاظًا على الخصوصية، لا تظهر النقطة أبدًا على الشاشة المقفلة: تُقرأ داخل التطبيق.

التطبيق متاح بالفرنسية والعربية.

تُنشئ المدرسة حسابكم: تتسلمون معرّف الدخول وكلمة المرور المؤقتة من أمانة المدرسة. لا يوجد تسجيل داخل التطبيق. ويمكنكم حذف حسابكم في أي وقت (الملف ← حذف حسابي).

لا إعلانات. لا تُباع بياناتكم ولا تُشارك لأغراض تجارية.

## 6. Le compte de démonstration (pour l'examinateur de Google)

Sur le site (une fois l'école configurée) : une classe, un élève fictif
(« Élève Démo »), une famille fictive avec un numéro de téléphone, quelques notes,
une absence, un message. **Connectez-vous UNE fois avec ce compte dans
l'application et choisissez son mot de passe définitif** : un compte qui exige
un nouveau mot de passe à la connexion bloquerait le deuxième examinateur. Dans
« Accès à l'application », donnez le numéro et ce mot de passe, avec :
« Compte parent de démonstration. Identifiant : le numéro de téléphone.
Aucune autre étape. »

## 7. Les étapes de publication (compte personnel)

1. **Tests internes** (facultatif, immédiat) : envoyer le `.aab`, vérifier l'installation.
2. **Test fermé** : créer le test, y envoyer le `.aab`, ajouter la liste des
   12 testeurs (ou plus), leur envoyer le lien d'inscription ; chacun s'inscrit
   et installe. **Laisser tourner 14 jours sans interruption.**
3. **Demander l'accès à la production** (tableau de bord) : répondre au
   questionnaire sur le test.
4. **Production** : créer la version avec le même `.aab` (ou un plus récent),
   pays : Mauritanie (et d'autres au besoin), envoyer en examen.

Chaque nouvelle version : augmenter `version:` dans `apps/mobile/pubspec.yaml`
(le numéro après `+` doit toujours croître), puis `BRAND=elmourad tools/packager.sh android`.
