# Jinan — publier sur Google Play

Tout ce qu'il faut saisir dans la Play Console, dans l'ordre. Les visuels sont à
côté de ce fichier : `icone-512.png`, `graphique-1024x500.png` (le logo complet
dans `deploy/brands/jinan/logo/`, généré par `tools/logo_jinan.py`).

⚠ **Préalables qui bloquent la publication, tant qu'ils manquent :**
1. **Le domaine** et le site en ligne (deploy/jinan/README.md). L'adresse du
   serveur est compilée dans l'application : sans `API_URL` dans
   `deploy/brands/jinan.env`, `packager.sh android` refuse de construire. Google
   ouvre aussi les pages `/legal/confidentialite` et `/legal/suppression` pendant
   l'examen : elles doivent répondre.
2. **L'autorisation de l'école.** Publier « l'application officielle » d'un
   établissement depuis un compte qui n'est pas le sien relève de la règle
   d'usurpation d'identité de Google Play : gardez une lettre de l'école (Heavenly
   Private Educational Institution) qui vous autorise, ou publiez depuis un compte
   **organisation** au nom de l'école (numéro D-U-N-S requis).

## 1. Construire le .aab (PC de construction, Git Bash)

La clé de téléversement existe déjà : `apps/mobile/android/jinan-upload.jks` et
`key-jinan.properties` (copie dans `C:\Eduplateforme\jinan_deployement`).
**Copiez-les aussi hors du PC (clé USB + un second support)** : sans eux, plus
aucune mise à jour ne peut être envoyée sans demander à Google une nouvelle clé.

L'adresse du serveur est déjà dans `deploy/brands/jinan.env` (écrite le
29/09/2026 par `deploy/jinan/configurer-production.sh`) :

    API_URL=https://api.ecole-jinan.com
    WEB_URL=https://ecole-jinan.com

À chaque version :

    BRAND=jinan bash tools/packager.sh android   # dist/jinan-parent-<version>.aab, vérifié
    BRAND=jinan bash tools/packager.sh apk       # dist/jinan-parent-<version>.apk (essais)

`packager.sh android` refuse de livrer un paquet sans l'adresse du serveur, ou
avec une permission photos/vidéos, l'identifiant publicitaire ou le mode
débogage. Le paquet cible Android 16 (API 36), exigé depuis le 31 août 2026.

**Un .aab construit ailleurs** (sans la clé) arrive sous le nom
`jinan-parent-<version>-non-signe.aab`. Le signer sur le PC qui détient la clé,
sans rien reconstruire :

    BRAND=jinan bash tools/signer-aab.sh dist/jinan-parent-<version>-non-signe.aab
    # → dist/jinan-parent-<version>.aab, vérifié ; l'empreinte SHA-256 affichée
    #   doit être 8D:76:DF:C8:…:CE:7E:F2:86 (sinon Google le refuse).

Notifications instantanées (facultatif, sinon l'application interroge le
serveur) : dans le projet Firebase `el-mourad`, ajouter l'application Android
`mr.jinan.parent`, puis recopier ses quatre valeurs dans `deploy/brands/jinan.env`
(voir le commentaire FIREBASE_* du fichier) avant de construire.

## 2. Le compte développeur

play.google.com/console → 25 $ → vérification d'identité, du téléphone et de
l'accès à un appareil Android. ⚠ Un compte **personnel** récent doit faire
tourner un **test fermé avec au moins 12 testeurs inscrits pendant 14 jours
d'affilée** avant de pouvoir publier en production (personnel de l'école et
parents volontaires, chacun avec un compte Google et un téléphone Android). Un
compte organisation en est dispensé.

## 3. Créer l'application

Nom `Jinan – Espace parents` · langue par défaut Français (fr-FR) · Application ·
Gratuite. Signature d'application Play : **accepter le choix par défaut** (Google
garde la clé de signature ; vous téléversez avec la vôtre).

## 4. Contenu de l'application (App content)

| Rubrique | Réponse |
|---|---|
| Règles de confidentialité | https://ecole-jinan.com/legal/confidentialite |
| Accès à l'application | « Tout ou partie de l'app est restreinte » → le compte de démonstration (§ 6) |
| Annonces | Non, pas de publicité |
| Classification du contenu | Catégorie « Référence, actualités ou éducation » ; violence, sexe, langage, drogues, jeux d'argent : Non ; échanges entre utilisateurs : **Non** (les parents lisent les messages de l'école, n'en envoient pas) ; partage de position : Non ; achats numériques : Non |
| Public cible | **18 ans et plus uniquement** (l'application sert les parents) ; « attire les enfants » : Non |
| Identifiant publicitaire | Non (aucune permission AD_ID) |
| Applis gouvernementales | Non |
| Fonctionnalités financières | Aucune (l'application n'encaisse rien ; elle n'affiche pas de montants) |
| Santé | Non — le service « Docteur » est une ligne de facturation ; aucune donnée médicale n'est collectée |
| Sécurité des données | Voir `docs/legal/declarations-magasins.md` : nom, téléphone, e-mail facultatif (infos personnelles) ; notes, absences, remarques, paiements (données de l'élève et financières) ; jeton de notification (identifiant d'appareil). Chiffrées en transit : Oui. Suppression possible : Oui. Aucune vente, aucune publicité. |
| Suppression de compte (URL) | https://ecole-jinan.com/legal/suppression — le compte est créé par l'école ; la suppression existe aussi dans l'application (Profil → Supprimer mon compte) |

## 5. Fiche du Play Store

Catégorie **Éducation** · site https://ecole-jinan.com · e-mail de contact
**infoheavenly24@gmail.com** · téléphone **+222 46 33 02 42** · adresse 465 E Nord,
Tevragh Zeina, Nouakchott. Icône : `icone-512.png`. Image de présentation :
`graphique-1024x500.png`. Captures : au moins 2 (idéalement 4 à 8) captures du
téléphone, en 9:16, prises dans l'application avec le compte de démonstration.

### Français (fr-FR)

**Nom** (30 max) : Jinan – Espace parents

**Description courte** (80 max) :
Notes, absences, devoirs et messages de l'école de vos enfants, en temps réel.

**Description complète** :

Jinan – Espace parents est l'application officielle de Heavenly Private Educational Institution (Jinan), à Tevragh Zeina, Nouakchott. Elle réunit, pour les parents et les tuteurs, tout ce que l'école publie sur leurs enfants.

Ce que vous y trouvez :
• Les notes de chaque évaluation, et les bulletins à télécharger en PDF
• Les absences, dès qu'elles sont saisies
• Les exercices et devoirs donnés en classe
• Les remarques des enseignants
• L'emploi du temps de la classe
• Les messages de l'école

Des notifications vous préviennent dès qu'une note, une absence, un exercice, un message ou un paiement est enregistré. Par discrétion, une note ne s'affiche jamais sur l'écran verrouillé : elle se lit dans l'application.

L'application est en français et en arabe.

Votre compte est créé par l'école : votre identifiant et votre mot de passe provisoire vous sont remis au secrétariat. Il n'y a pas d'inscription dans l'application. Vous pouvez supprimer votre compte à tout moment (Profil → Supprimer mon compte).

Aucune publicité. Vos données ne sont ni vendues ni partagées à des fins commerciales.

### العربية (ar)

**الاسم**: جنان – فضاء الأولياء

**الوصف القصير**:
نقاط أبنائكم وغياباتهم وواجباتهم ورسائل المدرسة، أولًا بأول.

**الوصف الكامل**:

«جنان – فضاء الأولياء» هو التطبيق الرسمي لـ Heavenly Private Educational Institution (جنان) في تفرغ زينة، نواكشوط. يجمع للآباء والأوصياء كل ما تنشره المدرسة عن أبنائهم.

ما تجدونه فيه:
• نقاط كل تقييم، وكشوف النقاط للتحميل بصيغة PDF
• الغيابات فور تسجيلها
• التمارين والواجبات المعطاة في القسم
• ملاحظات الأساتذة
• جدول حصص القسم
• رسائل المدرسة

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

## 7. Les étapes de publication

1. **Tests internes** (facultatif, immédiat) : envoyer le `.aab`, vérifier l'installation.
2. **Test fermé** (compte personnel) : créer le test, y envoyer le `.aab`, ajouter
   la liste des 12 testeurs (ou plus), leur envoyer le lien d'inscription ; chacun
   s'inscrit et installe. **Laisser tourner 14 jours sans interruption.**
3. **Demander l'accès à la production** : répondre au questionnaire sur le test.
4. **Production** : créer la version avec le même `.aab` (ou un plus récent),
   pays : Mauritanie (et d'autres au besoin), envoyer en examen.

Chaque nouvelle version : augmenter `version:` dans `apps/mobile/pubspec.yaml`
(le numéro après `+` doit toujours croître), puis `BRAND=jinan bash tools/packager.sh android`.
