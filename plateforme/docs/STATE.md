# STATE — where the project is

**The single most important file.** Read it first every session. Update it last,
every session, even short or unproductive ones.






## 0.7.8+18 — JINAN : LE NOM DE L'ÉCOLE — 2026-09-29 (nuit)

**Demande du propriétaire :** « change the school label in the website to
Heavenly private educational institution ».

- Le nom affiché (barre latérale, connexion, titre des onglets, reçus,
  bulletins) est `schools.name`. Il vient désormais du fichier de marque :
  `SCHOOL_NAME="Heavenly Private Educational Institution"` (capitales de la
  raison sociale, comme `LEGAL_ENTITY`) ; `SCHOOL_NAME_AR` reste « جنان ».
- `install.sh` remet ce nom dans `.env` à chaque installation ou mise à jour
  et passe `--sync-name` à `bootstrap-school`, qui l'applique à une école
  déjà installée (sans lui, une école existante garde son nom : El Mourad
  inchangé). Ni le modèle de facturation ni le préfixe des reçus ne bougent.
  Tests : `bootstrap-school.test.ts` (+3).
- Barre latérale : un nom sur plusieurs lignes est resserré
  (`responsive.css`, `.sidebar-logo span`).
- Restent « Jinan » : l'enseigne (`BRAND_NAME`) — la fin du titre des
  onglets (« … — Jinan »), le « © Jinan » de la page de connexion, le nom de
  l'application Android.

## 0.7.8+17 — JINAN : LE SERVEUR DE PRODUCTION — 2026-09-29 (nuit)

**Donné par le propriétaire :** l'IP du VPS **209.74.66.223** et le domaine
**ecole-jinan.com**.

- `bash deploy/jinan/configurer-production.sh 209.74.66.223 ecole-jinan.com
  namecheap-us` → `production.env`, `API_URL=https://api.ecole-jinan.com`,
  `WEB_URL=https://ecole-jinan.com`, `LEGAL_HOST` = Namecheap, serveur aux
  États-Unis (adresse enregistrée à Namecheap — RDAP NET-209-74-64-0-1 — et
  localisée aux États-Unis ; `namecheap-eu` si le VPS est en fait en Europe).
- Version **0.7.8+17** (pubspec) : ce code porte 0043, l'interface Jinan et les
  absences ; le paquet `dist/jinan-0.7.8+17.zip` (non commité, `dist/`).
- **Le DNS ne pointe pas encore vers le serveur** (vérifié le 29/09 par
  dns.google) : `@` → 192.64.119.103 (parking Namecheap), `www` → CNAME de
  parking, `api` absent, aucun AAAA. À faire chez Namecheap (Domain List →
  Manage → Advanced DNS) : supprimer les enregistrements de parking, créer
  trois **A** `@`, `www`, `api` → 209.74.66.223.
- Le serveur lui-même n'a pas pu être joint depuis ce bac à sable (sortie par
  mandataire HTTPS seulement) : rien n'y a été installé.

### Prochaine tâche
Le propriétaire : DNS (ci-dessus), puis `deploy/jinan/README.md` §1–§2 avec
`dist/jinan-0.7.8+17.zip` ; ensuite Frais, horaires des agents, application
Android (`BRAND=jinan bash tools/packager.sh android`).

## JINAN : L'INTERFACE WEB TERMINÉE, LES ABSENCES DU PERSONNEL, LA PRODUCTION EN UN ENDROIT — 2026-09-29 (soir)

**Demande du propriétaire :** « faire ce qui reste » (document
`JINAN-RESTE-A-FAIRE.md`, livré en zip avec les sources de la branche
`jinan/web-en-cours`), pendant qu'il fournit l'IP et le domaine de
production ; **et ajouter les absences des agents et des professeurs, d'après
leur emploi du temps.**

**Où.** Le dépôt GitHub `ourwa` porte, à sa racine, le site PHP El Ourwa ; la
plateforme a été importée telle quelle dans `plateforme/` (commit
`b55e949`), sans toucher au site PHP. Branche `claude/jinan-web-completion-6wv8c0`.

### Fait
1. **Facturation « services », interface web** (ADR-0073 + addendum) : étape 1
   vérifiée dans le navigateur (Frais, Niveaux) ; inscription (`<ChoixFacturation>`),
   réinscription (modale, recherche, lot), fenêtre d'encaissement (services,
   total en décimal), fiche du correspondant (bloc Services, sous-lignes de
   mois, Reçu, ✕, exempter, arrêter, ajouter, changer de mode), reçu groupé,
   note des impayés. `studyMode` / `services` ne partent que vers une école
   « services ».
2. **Absences du personnel** (ADR-0074, migration **0043**) : `staff_work_hours`
   (horaires des agents), `personnel_absences` ; API `/personnel/…` ; page
   `/personnel/absences` (Journée, Synthèse du mois, Horaires des agents),
   menu direction et collecteur d'absence. Aucune retenue sur la paie.
3. **L'IP et le domaine de production** (ADR-0075) :
   `deploy/jinan/configurer-production.sh <ip> <domaine> [hébergeur]` →
   `production.env`, `API_URL`/`WEB_URL`, `LEGAL_HOST` ; les scripts de mise à
   jour et `install.sh` les lisent. `install.sh` nommait Hostinger en dur dans
   la politique de confidentialité : corrigé.
4. **`seed-jinan.ts`** (`pnpm --filter @elourwa/db seed:jinan`) : une école
   « services » inventée, relançable, jamais en production ; `e2e-run.sh` la
   remet à neuf à chaque passage. La graine principale donne des horaires aux
   agents (sans changer la suite de `rand()`).
5. Docs : DECISIONS (ADR-0073 addendum, 0074, 0075), GLOSSARY, FEATURES
   (12g, 12h, 12i), `docs/JINAN-RESTE-A-FAIRE.md` à jour.

### Trouvé en chemin (et corrigé)
- La journée des absences du 5 octobre lisait la grille de l'année **à venir**
  (sa période commence en juillet) : l'année ouverte est désormais préférée.
- Le formulaire de déclaration des absences entourait le tableau : les
  formulaires ✕ / Justifier y étaient **imbriqués** (HTML invalide) et ✕
  soumettait la déclaration.

### Vérifié
- Base **79/79**, partagé **121/121**, API **1008/1008** (987 d'avant + 21
  nouveaux ; un premier passage complet avait vu `famille.spec.ts` échouer au
  chargement, une fois — vert seul et au passage suivant), types propres (API,
  site, base, partagé).
- Navigateur (Chromium, Jinan de dév. + Nour) : `jinan-facturation.spec.ts`
  8/8, `absences-personnel.spec.ts` 4/4 ; `dossier-famille`,
  `mot-de-passe-genere`, `toutes-les-pages` (absences comprises) : 85 passés,
  1 instable repassé à la reprise, 0 échec. Captures 375 et 820 px des pages
  Jinan (Frais, inscription, fiche, absences) : rien hors écran.
- Suite entière : 141 passés, 5 instables (repassés), 11 échecs — tous dans
  `exercice.spec.ts` (2) et `mobile.spec.ts` (9, débordements à 375 px sur des
  pages non touchées). **Le code d'avant ces travaux (b55e949), lancé sur la
  même machine, échoue de la même façon** (exercice 2/2, mobile 7 — un ensemble
  différent à chaque passage) : propre à ce bac à sable, pas une régression.

### Décisions du propriétaire (29/09, après la livraison)
- Les décisions D1–D6 de la facturation : **gardées telles quelles** (ADR-0073
  addendum).
- Les absences **ne réduisent pas** le salaire (ADR-0074).
- **La secrétaire lit la liste des moyens de paiement** : fait (ADR-0076) —
  `GET /payment-methods` s'ouvre à `scolarite.inscrire` / `reinscrire`
  (l'administrateur aussi, même raison) ; gérer les moyens reste à la
  direction. Test du garde + test du navigateur (la secrétaire inscrit et
  encaisse, reçu de 5 200 MRU).

### Connu, non corrigé
- Un avertissement d'hydratation (`data-cartes`, `tableaux-cartes.tsx`) sur les
  pages à tableaux, antérieur (Nour aussi).
- `e2e/exercice.spec.ts` : l'envoi d'une pièce jointe répond « Fichier vide »
  dans ce bac à sable, avant comme après ces travaux ; `mobile.spec.ts`
  instable à 375 px, idem. À relancer sur le poste habituel.

### Prochaine tâche
- **Le propriétaire** : acheter le VPS et le domaine, puis
  `bash deploy/jinan/configurer-production.sh <ip> <domaine> namecheap-eu`,
  commiter, installer (`deploy/jinan/README.md`).
- Facultatif : relecture adverse de l'API de facturation.

## 0.7.7+16 — « FRAIS GRAYTNA » ET LE MOT DE PASSE PARENT GÉNÉRÉ — 2026-09-28

**Demande (El Mourad) :** « frais de photocopie » devient « frais graytna » ; le
mot de passe généré automatiquement. **Précisé par le propriétaire :** El Mourad
seulement, écrit « Frais Graytna » ; le mot de passe : les comptes PARENTS.

- `FEE_PHOTOCOPY_LABEL` (facultatif ; `libelleFraisPhotocopie()`,
  packages/shared/src/brand.ts) — lu à l'affichage par l'API (frais dus,
  fenêtre d'encaissement, reçus annuels, historique de caisse, rapport) et le
  site (caisse du correspondant, reçu annuel). El Mourad :
  `deploy/brands/elmourad.env` → install.sh le remet dans `.env` à chaque mise à
  jour → docker-compose (api, web). Les démos gardent « Frais de photocopie ».
  Seul le NOM change : clé `photocopy`, barèmes, montants et reçus émis
  intacts ; un reçu réimprimé porte le nom d'aujourd'hui.
- Comptes parents : l'admission (« Mot de passe initial », nouveau parent) et
  « Reset mdp » arrivent remplis d'un mot de passe généré
  (`genererMotDePasse()`, crypto.getRandomValues, politique 8 car. / 3 types),
  visible, modifiable, ↻ pour un autre. Le message de réinitialisation le
  répète (à remettre au parent). Toutes les écoles.
- Tests : shared (2 000 tirages conformes, nom par défaut / El Mourad), API
  (annual-fees-gate : le nom change, pas le montant), e2e
  (mot-de-passe-genere.spec.ts). Finance API : 86 tests verts.

## 0.7.6+15 — LES FEUILLES VERSIONNÉES, LA MISE À JOUR QUI SE PROUVE — 2026-09-24

**Signalé :** « les changements ne sont jamais arrivés chez El Mourad », alors que
le script disait « Done ». **Constaté** (curl + Playwright, 375 et 820) : le
serveur servait bien 0.7.5+14 — responsive.css du zip (Last-Modified 14:15:42),
pages.css corrigée, /login identique à la démo, www/http aussi, pas de service
worker, Caddy sans cache. Ce qui restait vieux : le navigateur du téléphone (les
feuilles de public/ gardent le même nom d'une version à l'autre).

- `/elourwa/*.css?v=AAAAMMJJTHHMMSS` : une valeur par construction
  (`VERSION_FEUILLES`, next.config.mjs) — tout navigateur recharge les feuilles
  après une mise à jour.
- `mettre-a-jour.ps1` relève cette valeur sur /login AVANT et APRÈS, et échoue
  si elle n'a pas changé : « Done » veut maintenant dire « le site en ligne est
  la nouvelle construction ».
- /finance/dettes, téléphone : les pastilles d'échéances (« Janv 2027 : 10 000 »)
  passent à la ligne dans la carte (`td` en `flex-wrap`) — plus rien hors écran,
  aux 5 largeurs.
- Paquet : `Eduplateforme/elmourad_deployement` (zip + script + clé de
  signature Play d'El Mourad, hors git).

## 0.7.5+14 — LE SITE RESPONSIVE (TÉLÉPHONE, IPAD, BUREAU) — 2026-09-24

**Demande :** « 100 % responsive, beau sur tous les appareils », plateforme
comprise ; déployer sur Render, chez El Mourad (Hostinger) et en local.

- **Défaut trouvé** : `pages.css` portait le `<style>` de la fenêtre
  d'impression de revenue_live.php (`body { padding: 2rem }`, `th, td` bordés)
  — appliqué à TOUTES les pages : 64 px perdus sur téléphone, un filet sur chaque
  case. Retiré (les fenêtres d'impression ont leur propre copie).
- **`public/elourwa/responsive.css`**, chargée en dernier (les feuilles d'El
  Ourwa restent intactes) : en-tête compact (≤1024), non collant sur téléphone ;
  onglets en une rangée défilante ; chiffres clés 2 par rangée sur téléphone ;
  cibles tactiles 40 px (≤1024) ; grilles « 1fr 1fr » en une colonne (≤820) ;
  modales en feuille montante (≤640) ; barre latérale 232 px (1025–1366) ;
  ombres de défilement sur les tableaux larges.
- **Les tableaux de liste en cartes sur téléphone** :
  `components/tableaux-cartes.tsx` (≥ 4 colonnes, en-tête simple, pas de
  fusion ni de champ de saisie).
- **Relevé** : `e2e/capture-responsive.spec.ts` (CAPTURE=1) — 47 pages × 5
  largeurs (375/820/1024/1180/1440) : aucun débordement horizontal ; cibles
  trop petites 115 → 0 (hors œil du mot de passe) ; en-tête téléphone 153 → 105 px.
- Reste connu : une puce de mois de /finance/dettes coupée à 375 (rognée par son
  conteneur, sans défilement de la page). La revue page par page à cinq
  relecteurs a été arrêtée à la demande (« finish this fast »).
- Version des paquets : 0.7.5+14 (le site ; l'application Android n'a pas
  changé depuis 0.7.4+13).

## 0.7.4+13 — LE DÉPÔT = LA PRODUCTION, LE MENU SUR TÉLÉPHONE, LE BALAYAGE DU SOIR, L’APPLICATION PLAY STORE — 2026-09-23

**La demande du propriétaire (23/09, soir) :** corriger tous les défauts,
commiter en local et en ligne ; **le site n'est pas responsive — sur téléphone
la barre latérale disparaît** ; construire l'application El Mourad selon
`CLAUDE-CODE-BRIEF-elmourad-0.7.3.md` (Play Store) ; un script pour déployer
sur le VPS Hostinger 187.7.18.252 ; le zip hébergé (0.7.3+12) est fourni.

### Ce qui a été fait, dans l'ordre (ADR-0072)

1. **Le dépôt rejoint la production** : `elmourad-0.7.3+12.zip` (l'arbre
   déployé sur https://elmouradarafat.cloud) recopié sur 0.7.2+11 — 76 fichiers
   (51 nouveaux, 25 modifiés), commit `7ae36c0`, étiquette `v0.7.3+12`. Une
   seule différence avec le zip : le mot de passe provisoire de la direction,
   écrit en clair dans `deploy/elmourad/README.md` et l'en-tête d'install.sh,
   remplacé par un gabarit (un identifiant réel n'entre pas dans git).
2. **Le balayage du soir** (`89b29e0`, `fccd9e7`) : cinq chercheurs, trois
   relecteurs par constat ; les constats restés sans vote (limite d'usage)
   relus un par un. Voir ADR-0072 pour la liste. Tests :
   `balayage-23-09.spec.ts`, `periode-attribuee.spec.ts`.
3. **Le menu sur téléphone** : la feuille de style (la sienne) range la barre
   hors de l'écran sous 1024 px et attend un bouton — jamais porté.
   `components/tiroir-navigation.tsx` = son `#sidebar-toggle` + le tiroir de
   `assets/js/app.js`. `e2e/mobile.spec.ts` l'ouvre et le referme à 375 px.
4. **0.7.4+13** : l'application porte les corrections du balayage (mode de
   livraison dit par le serveur, test du serveur honnête, erreur du PDF,
   arabe) ; d'où un numéro au-dessus de celui du brief (12). Le Play Store
   accepte 13 comme premier envoi.
5. **`deploy/elmourad/mettre-a-jour.sh`** : la mise à jour du serveur depuis
   le PC, en une commande (zip → envoi → sauvegarde → code remplacé sans
   toucher .env ni secrets/ → install.sh → /health). **Non lancé** : le brief
   dit de ne pas toucher au serveur ; c'est au propriétaire de le lancer.

### La construction Android

- **La chaîne** : Flutter 3.47.5 (Dart 3.13.4), SDK Android 36 (build-tools
  34/35/36), JDK 17. Flutter 3.47.5 impose Gradle ≥ 8.14, AGP ≥ 8.11.1, Kotlin
  ≥ 2.2.20 et minSdk ≥ 24 : **Gradle 8.14.3, AGP 8.11.1, Kotlin 2.2.20,
  minSdk 24 (Android 7.0)** — le brief disait 21, que Flutter refuse depuis
  3.35 ; 23 a été réécrit en 24 par le migrateur de Flutter. Pas de
  `ndkVersion` : Flutter demande tout de même le NDK 27.0 (symboles de
  débogage du .aab), téléchargé une fois (~800 Mo) dans C:Androidsdk
dk.
- **La clé d'envoi El Mourad** : `apps/mobile/android/elmourad-upload.jks` +
  `key-elmourad.properties` (`CN=El Mourad`, SHA-256
  06:62:CE:FB:…:A7:1D), créées le 23/09, ignorées par git. À sauvegarder.
- **Le serveur** : `deploy/elmourad/mettre-a-jour.sh` (non lancé : c'est au
  propriétaire de le lancer). La clé Firebase du serveur est celle du
  propriétaire (id `1985…`) ; une ancienne (`e9dd…`, créée le 23/09 au matin,
  sans doute posée sur Render) est gardée à part dans `secrets/`.
- **Les paquets, vérifiés le 24/09 contre le brief** : `dist/elmourad-parent-0.7.4+13.aab`
  (Play Store) et `.apk` (essais seulement). `mr.elmourad.parent`, versionCode 13,
  versionName 0.7.4, targetSdk 36, minSdk 24, libellé « El Mourad », icône de la
  marque (`mipmap-anydpi-v26/ic_launcher.xml`), `https://api.elmouradarafat.cloud`
  dans `libapp.so`, pas de débogage, les permissions exactement celles de
  `docs/legal/declarations-magasins.md` (aucune de stockage/médias/AD_ID),
  certificat `CN=El Mourad` (SHA-256 0662cefb…a71d), alignement 16 Ko vérifié
  (`zipalign -c -P 16`). **Non vérifié sur un téléphone** (aucun sur le poste).
- **La vérification de packager.sh** disait « API_URL introuvable » à tort :
  `unzip -p … | grep -q` sous `pipefail` (SIGPIPE). Corrigée (fichier extrait).

### Prochaine tâche

- Le propriétaire lance `bash deploy/elmourad/mettre-a-jour.sh` depuis Git
  Bash (le serveur passe à 0.7.4+13 : balayage + menu téléphone).
- Il sauvegarde `apps/mobile/android/elmourad-upload.jks` et
  `key-elmourad.properties` en DEUX endroits hors du PC (perdue, la clé
  d'envoi se remplace par une demande à Google, pas en une minute).
- Play Console : `docs/store/elmourad/PLAY-CONSOLE.md`, avec
  `dist/elmourad-parent-0.7.4+13.aab`.
- Sur un vrai téléphone Android 16 : les vérifications « On an Android 16
  phone » du brief (icône, pas de ligne Serveur, connexion, permission,
  bulletin, retour, Confidentialité) — aucun appareil sur le poste.

## LA RENTRÉE VIDE, LE PDF, LES NOTIFICATIONS QUI SE LISENT, PLUSIEURS NUMÉROS — 2026-09-23

**La demande du propriétaire (23/09, après-midi) :** « the elourwa app is
broken » — les onglets Absences, Remarques et Emploi du temps vides malgré
la notification reçue ; le bulletin pas téléchargeable ; les notes bloquées
« sans dette » ; les notifications lentes, sans vibration, absentes quand
l'application est fermée ; « Gérer l'absence » qui dit « Pas d'emploi du
temps » sous une grille pleine ; **plusieurs numéros de téléphone par
parent** ; balayage, zip et APK El Mourad, tout poussé, les artefacts.

### Ce qui a été trouvé, et corrigé (ADR-0071)

| Symptôme | Cause | Correction |
|---|---|---|
| Absences / Remarques vides, carte de l'enfant à zéro | Les deux étaient bornés aux **mois nominaux** de l'année active (1er octobre → 30 juin) ; une absence du **23/09/2026** sous 2026-2027 tombait avant | `AcademicYearService.periodeAttribuee()` : une année possède l'été et la rentrée qui la précèdent (du lendemain de la fin de la précédente ; sans précédente, depuis juillet) et reste ouverte tant qu'aucune suivante n'existe. Test `periode-attribuee.spec.ts` |
| Emploi du temps de l'enfant vide | Exigeait un enseignement **de l'année active** ; la grille d'un groupe est unique et portait ceux de l'an dernier | Comme son `enfant.php` (`WHERE edt.groupe_id = :g`) : la grille du groupe, sans filtre d'année |
| « Pas d'emploi du temps » dans Gérer l'absence | Même cause : `en.academic_year_id = année` sur les cases | La case est retenue si son enseignement est de l'année **ou** si la même matière est enseignée au groupe cette année — et c'est alors cet enseignement-là que l'appel enregistre (sa règle « pas d'appel sur une matière d'une année passée » est gardée) |
| Bulletin « pas téléchargeable » | `Printing.convertHtml` (vue web du téléphone, obsolète) échouait et l'application ne savait dire qu'« erreur réseau » | **PDF composé sur le téléphone** (`bulletin_pdf.dart`, mêmes chiffres, même mise en page, Noto Sans Arabic embarqué), **déposé dans Téléchargements** (MediaStore, Android 10+, aucune permission nouvelle) et ouvert ; sinon cache + lecteur, sinon partage |
| Notes « bloquées sans dette » | **Ce n'est pas un défaut** : son `parent_a_dette()` lit `parent_dette_totale()`, toutes années — la famille 30000000 de la démo doit 207 000 MRU (2025-2026, Rissala et Salam). Mais une famille de plusieurs écoles lisait l'avis pour **toutes** | Le fil de résultats nomme les écoles concernées (`withheldSchools`) ; l'application l'affiche |
| Notifications lentes | File vidée par minuteur (10 s) | **Réveil de la file** dès l'écriture (`PushService.reveiller`, 1 s) + minuteur à 3 s |
| Rien quand l'application est fermée, pas de vibration | Non mesurable depuis le téléphone : le jeton était-il seulement déclaré ? (le premier essai part souvent avant le réseau) | Profil → **« Notifications »** : version compilée avec Firebase, permission, jeton déclaré, serveur (`POST /parent/devices/status`) ; **redéclaration à chaque sondage** ; bouton **« Recevoir une notification de test du serveur »** (`POST /parent/devices/test`) ; une notification touchée dans la barre ouvre la cloche |

**Plusieurs numéros par famille (0041, `user_phones`)** : n'importe lequel
ouvre le compte avec le même mot de passe ; un numéro n'appartient qu'à un
compte ; « Comptes des parents » → *Numéros*, dossier de la famille →
*Numéros de la famille* ; le profil de l'application les liste. Test
`telephones-multiples.spec.ts`. Migration appliquée sur la base de
développement ; Render l'applique au démarrage.

### Vérifié

- API : suite entière verte après les changements (voir la fin de cette section).
- Site : `tsc` propre ; Comptes → Parents et le dossier de la famille ouverts
  dans le navigateur (ajout, retrait d'un numéro).
- Application : `flutter analyze` propre, `flutter test` vert ; APK
  construits — **non vérifié sur un téléphone** (aucun appareil sur le
  poste) : le premier essai réel est Profil → « Recevoir une notification
  de test du serveur ».

### Prochaine tâche

Le propriétaire installe `dist/parent-0.7.2+11.apk` (démo) ou
`dist/elmourad-parent-0.7.2+11.apk`, ouvre Profil → Notifications : les
quatre lignes doivent être vertes, et le test du serveur doit sonner
application fermée. Si la ligne « déclaré au serveur » reste rouge avec
« Services Google indisponibles », le téléphone n'a pas les services Google
(Huawei récent) : le sondage de fond (15 min) reste la seule voie.

## EL MOURAD, LA MARQUE, LE BALAYAGE DU 22/09 ET LA LIVRAISON — 2026-09-22

**La demande du propriétaire (22/09) :** vérifier que Render sert bien le
poste ; CSS responsive ; balayage complet des défauts et correction de chacun ;
**un site de branche sous l'enseigne « El Mourad »** (chaque libellé), **sans
console de plateforme**, prêt à héberger, avec les options d'hébergement ;
**l'application rebaptisée El Mourad** ; le zip El Mourad, l'application, et
l'état des plateformes. Précisions en cours de route : *une école neuve part
d'une base vide, rien de semé* ; *arrêter le balayage multi-agents, trop long
et trop coûteux, et corriger directement*.

### Livré (tout est poussé, `origin/master` = `8db722c`)

| Quoi | Où |
|---|---|
| **Zip El Mourad** | `dist/elmourad-0.7.0+9.zip` (2,5 Mo, `git archive HEAD` + `LISEZMOI-elmourad.md` + `VERSION.txt`) — dézipper, `deploy/elmourad/install.sh` |
| **Application El Mourad** | `dist/elmourad-parent-0.7.0+9.apk` (« El Mourad », `mr.elmourad.parent`, sans `API_URL` : l'adresse se saisit dans l'application) |
| **Application El Ourwa** | `dist/parent-0.7.0+9.apk` (API Render inscrite) |
| Hébergement | `docs/HOSTING.md` — recommandation : VPS européen ~5 €/mois (Hetzner CX22/CX23, OVH VPS-1) ; `deploy/elmourad/README.md` |
| Décisions | ADR-0069 (marque, école unique, école neuve), ADR-0070 (le balayage : corrigé / gardé / à trancher) |

### Ce qui a changé (trois commits : `b98bd35`, `90899e3`, `8db722c`, après `fe7f2e8`)

- **La marque** (`packages/shared/src/brand.ts`) : « El Ourwa » n'est plus
  écrit en dur nulle part où une personne le lit — site, API (courrier,
  `/health`), application (`--dart-define`), Android (`APP_ID`, `APP_LABEL`),
  iOS (`APP_DISPLAY_NAME`), pages légales (`{{marque}}`). Cookies préfixés par
  le slug de la marque.
- **L'école unique** (`SINGLE_SCHOOL_SLUG`, `PLATFORM_CONSOLE`) : tout hôte
  désigne l'école ; `/platform` (site) et `/platform/*` (API) → 404 ; un
  compte sans rôle est refusé à la porte. La règle du sous-domaine vit une
  fois (`@elourwa/shared/tenant-slug`) au lieu de quatre. Tests :
  `ecole-unique.spec.ts` (9), `tenant.service.spec.ts` (+3), `brand.spec.ts`,
  `tenant-slug.spec.ts`.
- **Une école neuve** : `pnpm --filter @elourwa/db bootstrap-school` — rôles,
  l'école, un compte de direction à mot de passe provisoire, rien d'autre.
  **Vérifié sur ce poste** : école `elmourad` installée sur la base de
  développement, connexion, changement de mot de passe imposé, puis **les 38
  pages du personnel ouvertes vides sans une erreur** (`/platform` → 404).
- **`/health` dit le commit et la migration** (`commit`, `migration`,
  `marque`, `mode`) : Render se compare enfin au poste
  (`git rev-parse HEAD` · `ls packages/db/migrations | tail -1`).
- **Le balayage** : 80 constats, **38 corrigés** (argent : Impayés « toutes
  » doublait les créances, l'année appliquait la remise avant les créances,
  notifier un paiement annulé, porte des examens sur l'année seule, synthèse
  de caisse en non signé, bulletin de classe à formule unique… ; accès :
  plafond avant l'authentification, `/auth/logout` jamais accepté, clé du
  verrou brute, exclus sur NNI ET RIM… ; notifications sans année, file
  courriel abandonnée, envois doublés ; application : 429 qui déconnectait,
  jeton présenté par deux isolats, pas de délai réseau, tableau de bord qui
  marquait tout lu, pannes rendues « aucun »… ; site : feuille de notes
  muette, année perdue, totaux en flottant, console sur localhost) — la liste
  complète, ce qui a été gardé et pourquoi, et ce qui attend une migration
  (règle 16) : **ADR-0070**. Tests d'abord pour l'argent :
  `impayes-coherence.spec.ts` (6).
- **Responsive** : mesuré, pas supposé — `apps/web/e2e/mobile.spec.ts`
  ouvre chaque page à 375 × 812 et refuse tout débordement horizontal :
  **47/48 sans débordement, 1 reprise (`/homework`, compilation)**. Les
  feuilles d'El Ourwa (24 `@media` dans `style.css`) tiennent déjà ; le
  tableau de bord vérifié à l'œil (cartes empilées, barre latérale repliée).
  Aucune feuille `responsive.css` n'a été nécessaire.
- **Deux serveurs de développement** (El Ourwa :3000/3001, El Mourad
  :3010/3011 via `scripts/dev-elmourad.sh`, `launch.json`) ne partagent plus
  `.next` (`NEXT_DIST_DIR`) — les partager corrompait les morceaux (404/500).

### Vérifié

| Moyen | Résultat |
|---|---|
| `pnpm typecheck` | ✓ (5 tâches) |
| API vitest | **876 / 876** (80 fichiers ; +9 école unique, +6 cohérence des impayés, +3 slug) |
| shared · db · tools | 86 · 36 · 18 ✓ |
| `flutter analyze` · `flutter test` | ✓ · **57 / 57** |
| Playwright `mobile.spec.ts` (375 px, 43 pages + connexion) | 47 ✓, 1 reprise |
| Playwright — la suite entière du site (137 tests, 13,7 min) | **134 ✓, 2 reprises (compilation), 1 hors suite** ; 3 renouvellements de session, 0 révocation |
| El Mourad sur ce poste | `/health` `mode: ecole-unique`, connexion, 38 pages vides sans erreur, `/platform` 404 |
| Render | poussé `8db722c` — vérifier `https://elourwa-demo.onrender.com/health` → `"commit":"8db722c…"`, `"migration":"0040_recus_groupes.sql"` |

### ⚠ Trouvé par la suite devenue plus longue que le jeton (22/09, soir)

La suite Playwright, passée de 8 à 20 minutes avec `mobile.spec.ts`, a
franchi pour la première fois la durée du jeton d'accès (15 min) — et **ses
sessions mouraient au premier renouvellement** (« Votre session a expiré »,
`refresh_tokens.revoked_reason = fingerprint_mismatch`). Deux causes, deux
corrections (`3d1770c`, `0ba46af`) :

- **Le harnais** : le projet `setup` de Playwright se connectait sans profil
  (User-Agent « HeadlessChrome/… ») et les tests tournaient en « Desktop
  Chrome » (« Chrome/… ») — l'API voyait un autre appareil au renouvellement
  et révoquait la famille, comme elle doit. Le projet `setup` prend le même
  profil. **Ce n'était pas un défaut du produit** : un vrai navigateur
  (vérifié dans le navigateur du poste, jeton renouvelé à 22:21) garde sa
  session.
- **Une vraie fragilité à côté** : l'adresse transmise par le site en
  `X-Client-IP` (`::1` ou `127.0.0.1` selon la connexion du navigateur au
  poste) n'était pas normalisée comme le pair l'est, et l'empreinte IPv6
  prenait l'adresse entière (une adresse IPv6 change seule, extensions de
  confidentialité) : normalisées, /64 pour IPv6. `JWT_ACCESS_TTL` est enfin
  lu (nommé dans `.env.example`, jamais lu) ; une empreinte différente est
  dite dans le journal de l'API.

Vérifié après : 134 tests verts, 3 renouvellements, 0 révocation.

### Les notifications instantanées existent — 23/09, matin

Le propriétaire (600 usagers au plus, « instant notifications are a priority »)
s'est connecté à la console Firebase dans le navigateur du poste ; le projet
a été créé et réglé depuis là (**docs/FIREBASE.md**, section « Fait le
23/09 ») : projet `el-mourad` (numéro `721820198526`), deux applications
Android — `mr.elmourad.parent` et `mr.elourwa.parent` (la démo Render) —,
Cloud Messaging V1 actif, clé de service générée et **vérifiée depuis le
poste** (jeton OAuth Google 200, API FCM v1 atteinte). La clé vit dans
`deploy/elmourad/secrets/fcm-service-account.json` (ignorée par git, absente
du zip ; l'original est dans les Téléchargements du poste) ; `install.sh` la
lit et la passe à l'API. Les quatre `FIREBASE_*` sont dans
`deploy/brands/elmourad.env` (El Mourad) et `deploy/brands/elourwa-demo.env`
(la démo).

Livré : **`dist/elmourad-parent-0.7.1+10.apk`** (Firebase compilé — l'identifiant
d'expéditeur est dans le binaire) et **`dist/parent-0.7.1+10.apk`** (la démo,
même projet), **`dist/elmourad-0.7.1+10.zip`**. Ce qui reste au propriétaire :
sur Render, poser `FCM_SERVICE_ACCOUNT` (le JSON sur une ligne) dans
l'environnement du service pour que la démo pousse ; sur le serveur El
Mourad, déposer la clé dans `secrets/` avant `install.sh`. Non vérifié sur un
téléphone (aucun appareil sur le poste) : le premier essai réel est le test
du bouton « Tester la sonnerie et la vibration » puis un message envoyé depuis
le site.

Au passage : `deploy/elmourad/install.sh` ne passait pas `bash -n` (une
apostrophe dans une expansion `${…:?…}`) — il n'avait jamais été lancé ;
corrigé, et le script est désormais vérifié à chaque commit qui le touche.

### Hypothèses à confirmer par le propriétaire

- Le nom arabe **« المراد »** (translittération) — `deploy/brands/elmourad.env`.
- L'identifiant Android **`mr.elmourad.parent`** et la clé de signature
  (celle d'El Ourwa pour l'instant).
- Les notifications poussées d'El Mourad : une application Android distincte
  dans un projet Firebase (`FIREBASE_*`, `FCM_SERVICE_ACCOUNT`).
- ADR-0070 « attend une décision » : quatre migrations (une seule année
  active ; absences de journée uniques ; `evening_teachings.teacher_id` ;
  les cascades restantes) et le sort de `POST /finance/payments` /
  `/finance/collection` (gardées pour `caisse-direction-only.spec.ts`).

### État des plateformes et des applications

| | État |
|---|---|
| **El Ourwa — démonstration** | Render (`elourwa-demo.onrender.com`, gratuit, s'endort 15 min) + Neon ; écoles `nour`/`rissala`/`salam.elourwa.duckdns.org`, console `admin.` ; redéployée à chaque `git push` |
| **El Ourwa — application** | `dist/parent-0.7.0+9.apk` (API Render) ; versions précédentes 0.2.0+2 → 0.6.0+8 dans `dist/` ; `.aab` 0.2.0+2 signé ; iOS prêt, à archiver sur un Mac |
| **El Mourad — site** | pas encore hébergé : `dist/elmourad-0.7.0+9.zip` + `deploy/elmourad/install.sh` sur un VPS (docs/HOSTING.md) ; vérifié sur ce poste en école unique |
| **El Mourad — application** | `dist/elmourad-parent-0.7.0+9.apk` (adresse du serveur à saisir ; reconstruire avec `BRAND=elmourad API_URL=… tools/packager.sh apk` une fois hébergé) |

### Prochaine tâche

Choisir l'hébergeur d'El Mourad (docs/HOSTING.md), lancer `install.sh`,
reconstruire l'APK avec `API_URL`, puis trancher les points d'ADR-0070 ; la
ligne « Next task » du tableau « Right now » (réconciliation étendue) reste.

### ⚠ Pièges de la session, pour le suivant

- **L'outil Bash développe `\uXXXX` et `\n` dans le texte de la commande**,
  heredoc `<<'EOF'` compris (aucun fichier écrit, « unexpected EOF »). Sources
  avec l'outil Write ; Bash pour `node` et `sed` sans séquences d'échappement.
- **Compress-Archive (PowerShell 5.1) écrit des barres inverses dans le zip**
  → inutilisable sous Linux ; `git archive --format=zip --add-file=…`.
- **Deux `next dev` sur le même `.next`** : 404/500 aléatoires ; `NEXT_DIST_DIR`.
- Un fichier `.env` de marque se `source` : les valeurs avec espaces entre guillemets.
- `bash` n'est pas sur le PATH du lanceur de `preview_start` : `C:/Program Files/Git/bin/bash.exe`.
- Un balayage à 200 agents a brûlé 3 M de jetons et la limite d'usage avant
  de vérifier un seul constat : le propriétaire l'a fait arrêter. Un tour de
  chercheurs, puis corriger soi-même.

---



## LA LISTE DU 20/09 : UN SEUL REÇU, UNE FEUILLE PAR MATIÈRE, LE DOSSIER, LE BULLETIN DESSINÉ, LES NOTIFICATIONS DE FOND — 2026-09-20

Tout livré (**ADR-0068**), poussé, Render redéployé, APK `dist/parent-0.6.0+8.apk`.

| Défaut signalé | Sort |
|---|---|
| Frais annuels obligatoires à l'inscription | Cases à cocher, jamais obligatoires (ADR-0068) |
| Un reçu par mois payé | **Reçu groupé** (`receipts`, 0040) : mois cochés + frais cochés, un numéro — inscription, réinscription et caisse (multi-sélection) |
| Logique de dette | Calcul identique à El Ourwa (recoupé sur 40 familles) ; le défaut : le solde de l'application était borné à l'année active → « 0 » dès que 2026-2027 est ouverte sans réinscriptions. Solde toutes années (`detailAcrossYears`), test de transition ; l'écran vide de l'application explique la situation |
| Notifier les impayés | Formulaire imbriqué dans le filtre (interdit en HTML) → sorti ; 97 correspondants notifiés à l'essai |
| Référence de paiement absente des reçus | Perdue par les répartiteurs (`prendre`/`take`) → portée partout |
| Saisir notes : matière dupliquée avec deux professeurs | Affectations équivalentes, une feuille, canonique + rapatriement ; bulletin borné à l'année (copier les assignations vidait le bulletin passé) |
| Envoyer un exercice | Classe d'abord, matière ensuite ; circuit vérifié de bout en bout (e2e) |
| Modifier parent et enfants depuis le dossier | « Modifier le correspondant » + « Fiche de … » sur la page de la famille (API + audit + e2e) |
| Notifications qui ne surgissent pas sur Android | Tâche de fond WorkManager (15 min) + canal recréé ; bandeau dans l'application |
| Vue web du bulletin | Supprimée ; bulletin dessiné en widgets avec la mise en page du site ; PDF depuis le HTML du site |
| Dérogation = examens seulement | Déjà le cas (devoirs jamais retenus, vérifié) ; la page le dit |

Vérifications : API 856 tests, Flutter 57, shared 71, Playwright (exercice,
dossier famille, reçu groupé, pages) verts ; `tsc` api + web verts ; reçu
groupé essayé sur le site local (3 mois + frais d'inscription, Bankily réf.
BK-2026-0091 → NOUR-2025-00274, dette 186 500 → 121 500).

---

## LE BULLETIN ET L'EMPLOI DU TEMPS DE L'APPLICATION SONT CEUX DU SITE — 2026-09-20

Décision du propriétaire (19/09), livrée (**ADR-0067**) :

- **Bulletin** : un seul rendu HTML dans `@elourwa/shared`
  (`renderBulletinOfficiel`, `BULLETIN_CSS`, tests) ; le site l'insère ; l'API
  le sert aux familles (`GET /parent/children/:id/report-card/document?term=&lang=`,
  masquage pour dette appliqué avant) ; l'application l'affiche dans une vue
  web et en tire le PDF (« Télécharger le bulletin (PDF) »). Vérifié : le
  document de l'API et la page `/notes/bulletin/:id` du site rendent le même
  bulletin (capture des deux, 19/09 soir).
- **Emploi du temps** : la grille `edt-grille` du site, native sur le
  téléphone (sept jours, trois créneaux, terre cuite/crème, défilement
  horizontal, colonne des créneaux fixe, jour courant souligné).
- Application **0.5.0+7** (`webview_flutter`, `printing`, `pdf`) —
  `dist/parent-0.5.0+7.apk`. Suites : Flutter 54/54, shared 71/71, API 850/850,
  Playwright (pages bulletin/emploi) vert.

Le balayage ECC du 19/09 est **entièrement traité** : M8 (Impayés) est
corrigé par `forGuardians()` — les requêtes de `forGuardian()` pour toutes les
familles à la fois, la même `calculerDette()`, un test de parité famille par
famille ; les bas restants (journal du cliquet des examens, `lireFeuille`
partagée, `Push.attacher` hors du lancement, contrôleur libéré) aussi.

---

## BALAYAGE ECC — 2026-09-19 : six revues, 41 constats, 33 corrigés, 8 documentés (ADR-0066)

**Demande du propriétaire (19/09) :** « use ecc and deploy a subagent for every
task, run a full bug (logical, syntax, inconsistencies…) sweep covering all
aspects on the whole system and if any changes occurred commit locally and
online. » ECC = *Everything Claude Code*, le plugin installé dans
`~/.claude/plugins/marketplaces/ecc/agents/*.md`. Ses agents **ne sont pas
enregistrés comme types d'agent** (`ecc:typescript-reviewer` → « Agent type not
found ») : la méthode qui marche est un agent `general-purpose` à qui l'on dit
de lire la fiche persona puis de l'appliquer.

**État en fin de session :** tout est poussé (`origin/master`), Render
redéployé et vérifié (`/_sante` ok, `/health` 200 base up), APK
**`dist/parent-0.4.1+6.apk`** livré. Suites : API **849/849**, Flutter
**54/54**, `tsc` api + web verts. Migration **0039** appliquée en local et
en ligne.

**Les six revues ont rendu leurs constats (reprises de leur propre transcription,
pas relancées — c'est ce qui a marché).** Liste complète avec le sort de chacun ;
« à faire » = pas encore traité, à reprendre par la prochaine session.

*Exploitation (`deploy/render`)* — silent-failure-hunter, code-reviewer, security :

- **C1** `entrypoint.sh` lecture de la marque `2>/dev/null || echo ''` : un psql
  raté (Neon endormi) valait « marque différente » → `DROP SCHEMA` sur un simple
  redémarrage froid. **Corrigé** : trois lectures avec `ON_ERROR_STOP`, illisible
  ⇒ rien ; ligne absente ⇒ pas de remise à neuf, marque adoptée après migrations.
- **C2** `bash -c '… | tee'` n'hérite pas de `pipefail` : reset/migrate ratés
  passaient pour réussis, `surveiller` disait « code 0 » à chaque chute.
  **Corrigé** : `bash -o pipefail -c`, code capturé.
- **C3** marque `|| true` après reset ⇒ boucle de remise à neuf. **Corrigé** :
  `tenter 3`, message explicite si elle n'est pas gardée.
- **S1** `proxy.mjs` relaie `X-School-Slug` / `X-Client-IP` / `X-Client-User-Agent`
  envoyés par le client (l'API les croit depuis 127.0.0.1) ; `X-Forwarded-For`
  pris à gauche (forgeable : contourne le verrou 15 essais/15 min). **Corrigé** :
  en-têtes supprimés avant relais, adresse = entrée la plus à droite.
- **S2** `/_journal?cle=` compare `!==` le mot de passe Postgres, en query string.
  **Corrigé** : `timingSafeEqual`, `JOURNAL_KEY` dédiée si posée, 5 échecs/min.
- **S3** mot de passe d'`app_user` dans l'argv de psql. **Corrigé** : entrée standard.
- **H1** `/health` rend 200 `degraded` base en panne ; `/_sante` toujours 200.
  **Corrigé** : `/health` → 503 si base `down` ; `/_sante` → 503 après 5 min sans API+site.

*Sécurité API* — security-reviewer :

- **S4 CRITIQUE** `accounts.service.ts create()` rattache n'importe quel compte
  global par identifiant (y compris un admin plateforme ou le super_admin d'une
  autre école) puis `resetPassword` / `setActive` (`belongs` = « une ligne ici »)
  donnent son mot de passe / le désactivent partout. **Corrigé** : rattachement,
  réinitialisation, désactivation et `setRoles` refusés si la cible est admin
  plateforme ou tient un rôle dans une autre école (409 explicite) ; `setRoles`
  borné aux rôles attribuables ici et à un compte déjà présent ; tests.
- **S5** `tenant.interceptor.ts:86` session famille (`schoolId` null) acceptée
  sous n'importe quel slug. **Corrigé** : `ecolesFamille` doit contenir l'école.
- **S6** `sessions.service.ts` rotation en trois transactions (course = deux
  jetons vivants) ; `rotate()` ré-émet l'empreinte avec l'adresse pour une
  session famille (déconnexion au deuxième changement de réseau). **Corrigé** :
  `UPDATE … WHERE used_at IS NULL RETURNING`, 0 ligne ⇒ réutilisation ;
  `sansAdresse` conservé.
- **S7** `web/app/api/login/route.ts` sans contrôle d'`Origin` (login CSRF) ;
  `logout` redirige en `http://`. **Corrigé**.

*Argent* — database-reviewer, typescript-reviewer, code-reviewer :

- **M1** annulation d'un encaissement (`payments.service.ts:396`, `expenses`,
  `evening`) : contrôle « déjà annulé » hors transaction, pas de `FOR UPDATE`, pas
  d'unicité sur `reverses_id` ⇒ deux clics = deux contre-passations. **Corrigé** :
  migration 0039 (index uniques partiels) + `FOR UPDATE` dans la transaction.
- **M2** l'annulation d'un paiement/dépense n'écrit **pas** de lignes de moyens
  inverses (le soir le fait) ⇒ un reçu annulé compte toujours dans les totaux par
  moyen (`reports.service` byPaymentMethod, revenusDuJour, bilan) et `tillConsistency`
  signale un écart à chaque annulation. **À faire** (décision : copier le schéma
  du soir — `tender.post` direction inverse aux mêmes lignes). **Corrigé** :
  paiement ⇒ lignes `out`, dépense ⇒ lignes `in`, `tillConsistency` en signé.
- **M3** `resumeMoyens` : les deux seuls appelants (`expenses.service.ts:142`,
  `debt.service.ts:1467`) agrègent sans `reference` ⇒ « réf. » n'apparaît jamais
  dans la liste des dépenses ni des remboursements ; `payGlobalAction`
  (`actions.ts:510`) reconstruit `tender` sans `reference` ⇒ la référence saisie
  dans le règlement global est perdue. **Corrigé**.
- **M4** numéros `REMB-…`, `PRT-…`, `ADM-…` = date + aléa, sans unicité (règle 10).
  **Corrigé** : `nextDocumentNumber` + unicité `(school_id, receipt_number)` (0039).
- **M5** paie des vacataires (`payroll.service.ts:86/235/582`, `accounts:369`) :
  somme des `teachings` **toutes années** ⇒ après « copier les assignations »
  le gain de référence double. **Corrigé** : vérifié dans `paiement_staff.php`
  (son `enseignements` n'a pas d'année, il ne porte que le courant) ; les quatre
  requêtes filtrent sur l'année active (ADR-0066).
- **M6** `platform.service.ts:341` `INSERT users … ON CONFLICT (email) DO UPDATE`
  hors transaction : nommer un admin de branche avec l'e-mail d'un compte existant
  le renomme et lui donne `super_admin` en gardant SON ancien mot de passe.
  **Corrigé** : rattaché tel quel (`attached`), refusé pour un admin plateforme,
  transaction explicite.
- **M7** `reference.service.ts:755` `hourly_rate` via `Number()`. **Corrigé** (chaîne décimale validée).
- **M8** Impayés = N+1 sur ~1 372 familles (`debt.service.ts:1712`). **Corrigé**
  (20/09) : `forGuardians()` — les mêmes requêtes que `forGuardian()` avec
  `guardian_id = ANY(…)`, la même `calculerDette()` extraite mot pour mot,
  `annualFeesDueFor()`/`miscDebtsRemainingFor()` groupés ; test de parité
  famille par famille dans `debt-agreement.spec.ts`.
- **M9** index manquants `(school_id, reverses_id)` sur payments/expenses/evening
  (`NOT EXISTS` par ligne), `evening_payments(school_id, enrolment_id)`,
  `loan_repayments(school_id, loan_id)` ; FK mono-colonne `ON DELETE SET NULL` en
  0019 ; `UNIQUE` 0003 avec `academic_year_id` nul. **Corrigé** en 0039 (index, FK
  composite RESTRICT, `NULLS NOT DISTINCT`).

*Notes et années* — typescript-reviewer, code-reviewer :

- **N1** `grades.service.ts:280` notification de note : `score.replace(/\.?0+$/,'')`
  sur la chaîne brute ⇒ « 10 » devient « 1 », « 20 » → « 2 », « 0 » → « ». El
  Ourwa formate à 2 décimales d'abord. **Corrigé** + test.
- **N2** `grades.service.ts:256` absence testée `!== '-1'` (`-1.0` passe). **Corrigé** : `isAbsent`.
- **N3** `academic-year.service.ts:444` `close()` sur une année « à venir » ⇒
  deux années actives. **Corrigé** : seule l'année active se clôture ; test.
- **N4** `students.controller.ts:51` `GET /students` joint toutes les années ⇒
  doublons et curseur incohérent. **Corrigé** : inscription de l'année active seulement.

*Site* — silent-failure-hunter, code-reviewer :

- **W1** `finance/[guardianId]/page.tsx:74` dette `.catch(() ⇒ 0.00)` ⇒ le
  guichet dit « à jour » quand l'API est injoignable. **Corrigé** : panneau d'erreur.
- **W2** `prof/notes/page.tsx:42` erreur ⇒ « aucun enseignement ». **Corrigé**.
- **W3** `lib/session.ts:68` 5xx/réseau ⇒ « session expirée ». **Corrigé** :
  `erreur=api_injoignable`, journalisé.
- **W4** `re-enrol/bulk/bulk-forms.tsx:214` message publié deux fois ;
  `annees/forms.tsx` `Message` vide + import mort. **Corrigé**.
- **W5** `actions.ts` erreurs non-`ApiError` jamais journalisées. **Corrigé** :
  journal dans `apiFetch` (un seul endroit).

*Application* — flutter+kotlin reviewer, silent-failure-hunter :

- **A1 CRITIQUE** « Déconnexion » du menu et du portail mot de passe
  (`parent_shell.dart:227`, `main.dart:151/206`) ne passe pas par `api.logout()`
  ⇒ le jeton reste, le prochain lancement reconnecte, les push continuent.
  **Corrigé**.
- **A2** `api.dart:170` interblocage : refresh 4xx → `logout()` → `Push.detacher`
  → `DELETE /parent/devices` 401 → attend le même `_inFlight` ⇒ écrans figés.
  **Corrigé** : détachement sans nouvelle tentative de refresh.
- **A3** refresh refusé côté serveur ⇒ rien ne prévient la coquille (« serveur ne
  répond pas » à vie). **Corrigé** : `onSessionLost` → `_onSignedOut`.
- **A4** `ouvrir_fichier_stub.dart` choisi sur Android (`dart.library.js_interop`)
  ⇒ « Ouvrir » une pièce jointe ne fait rien. **Corrigé** : `ouvrir_fichier_io.dart`
  (cache + `open_filex`), export conditionnel à trois branches.
- **A5** `exercices_tab.dart:203`, `remarques_tab.dart:284` future recréée à
  chaque `setState` du sondeur ⇒ la liste clignote toutes les 15 s. **Corrigé**.
- **A6** premier `_surgir` : toutes les non-lues anciennes surgissent.
  **Corrigé** : seules les `delta` plus récentes.
- **A7** `_shared.dart:111` erreur réseau ⇒ « aucun enfant rattaché ». **Corrigé**.
- **A8** `report_card_screen.dart` `embedded` ignoré (double barre de titre) ;
  `child_screen.dart` en-tête 240 dp fixes (nom écrasé sur 360 dp) ;
  `change_password_screen.dart:71` erreurs réseau muettes ; `profil_tab.dart:500`
  `setDialog` après fermeture ; contrôleurs non libérés. **Corrigé** (bulletin
  sans seconde barre, chiffres sous le nom sous 480 dp + la fiche dans le test
  de mise en page, erreurs réseau dites, `mounted`, `dispose`). `Push.attacher`
  au lancement : laissé tel quel (une seconde au premier écran, pas un défaut).

**Prochaine session :** rien du balayage ne reste ouvert.
Reprendre la ligne « Next task » du tableau « Right now » : la réconciliation.
Après tout changement mobile : `API_URL=https://elourwa-demo.onrender.com
tools/packager.sh apk` → `dist/parent-<version>.apk`.

---

## UNE APPLICATION POUR TOUTES LES BRANCHES, LA CONSOLE QUI ADDITIONNE, ET LA LIVRAISON — 2026-09-17

Décisions du propriétaire du 14/09, toutes livrées (**ADR-0061**) :

- **Une seule application pour tous les parents de toutes les branches.** La
  connexion ne nomme aucune école : un **numéro mauritanien** (8 chiffres
  commençant par 2, 3 ou 4, `+222` facultatif — `@elourwa/shared/telephone`,
  la même règle dans `lib/src/telephone.dart`, testée à l'identique des deux
  côtés) et un mot de passe. La **session « famille »** (`espace: parent`,
  `schoolId: null`) couvre toutes les écoles où le compte est parent ;
  `/parent/*` parcourt chaque école sous son tenant (`runInTenant`) et
  fusionne — un parent avec un enfant à Nour et un autre à Rissala voit les
  deux, chaque enfant et chaque ligne porte son école ; le solde s'additionne
  seulement à monnaie égale. Un enfant d'une autre école est refusé partout
  (`famille.spec.ts`, 6 tests ; `/students/count` → 403 en session famille).
- **Le numéro mauritanien est imposé** à la connexion de l'application, à
  l'admission (nouveau responsable, stocké sous forme canonique), au changement
  d'identifiant d'un parent (unicité sur les huit derniers chiffres).
- **Les administrateurs de la plateforme se créent entre eux**, mêmes
  privilèges, mot de passe provisoire à changer, désactivables (jamais soi-même,
  jamais le dernier). `admin.localhost:3000/platform`.
- **La console cumule les caisses de toutes les branches** : encaissé et
  dépensé aujourd'hui, le mois et l'année choisis, rapport mensuel par branche,
  détail par origine, rapport annuel mois par mois — tout depuis
  `tender_lines`, en Decimal, additionné seulement à monnaie unique. Pour que
  le cumul soit vrai, l'importeur porte désormais `paiement_lignes.date_creation`
  dans `tender_lines.created_at` (16 008 lignes réparées, mesure « ventilé par
  mois » ajoutée au rapprochement).
- **Les reçus** : recensement de tous ceux de v23 contre les nôtres
  (`AUDIT-v23.md`, section « Reçus ») ; le seul manquant, le **remboursement
  de dette diverse** (`REMB-…`, `?dette_id=`, `?print_recu_remb=`), est
  reproduit — et notre remboursement à montant nu **ne passait pas en caisse**
  (la dette baissait, la caisse non) : il écrit maintenant ses lignes de
  moyens (`source dette`), testé avant (`misc-debt-repayment.spec.ts`).

⚠ La base de développement avait été semée AVANT la règle du numéro : ses
parents synthétiques portaient `+2220000002` (invalide) ; leurs téléphones ont
été alignés sur la formule actuelle de `seed.ts` (596 comptes `*.test`, rien
d'autre — l'école reprise `elourwa` garde ses vrais numéros). Ne pas relancer
`pnpm seed` sur cette base : il tronque tout, y compris la reprise.

### Le balayage final (17/09)

Vérification des invariants par recherche systématique, pas de mémoire :
aucun `SET` nu ni `set_config` hors `withTenant` ; `db.registry` ne touche que
`users`, `schools`, `roles`, `refresh_tokens`, `login_attempts`,
`outbound_*`, `platform_settings` (les tables de tenant passent par
`query`/`queryFor`) ; chaque méthode publique de `PlatformService` appelle
`assertPlatformAdmin` ; aucun lien du menu vers une page absente ; **les 263
appels `apiFetch` du site rapprochés des 275 routes de l'API** (script) —
deux actions appelaient des routes disparues (`/auth/forgot-password`,
`/auth/reset-password`, sans page appelante : retirées) ; et `arreterDette`
calculait l'écart d'une remise en `number` (règle 6) : en Decimal.

### Vérifié

| Moyen | Résultat |
|---|---|
| `tsc` api · web · tools | ✓ · ✓ · ✓ |
| `vitest` api | **823 / 823** ✓ (75 fichiers) |
| `vitest` shared · db · tools | 65 · 36 · 18 ✓ |
| `flutter analyze` · `flutter test` | ✓ · **43 / 43** (+3 : la règle du numéro, la connexion sans école) |
| `pnpm reconcile` — 92 mesures sur les données réelles | **92 / 92** ✓, code 0 (`docs/reconciliation/2026-09-16.md`) |
| Playwright, site du personnel, contre les serveurs vivants | **75 / 75** ✓ (1 reprise : `ERR_CONNECTION_RESET` à la première compilation de `/prof` ; 1 ignoré : l'empreinte structurelle, désormais hors suite — `STRUCTURE=1`) |
| Navigateur : session famille sur trois écoles, console cumulée, profil de dette et reçu `REMB` | ✓ (14/09–16/09) |

### Emballé (17/09) — version 0.2.0+2

`dist/serveur-0.2.0+2.tar.gz` (API + site Next.js construits en production,
migrations, pages légales, `RUNNING.md`), `dist/parent-web-0.2.0+2.tar.gz`
(l'application des familles, version web), `dist/parent-0.2.0+2.aab` (23,3 Mo,
signé avec `key.properties`, `mr.elourwa.parent`, code de version 2 — le Play
Store exige un code supérieur au précédent). Construits **sans `API_URL`** (pas
encore de serveur de production) : l'application démarre sur `localhost` et le
serveur se saisit sous le formulaire de connexion (« Serveur · modifier ») ;
pour publier, reconstruire avec `API_URL=https://api.<domaine>` et les
`FIREBASE_*` (`docs/RUNNING.md` § 3). Les anciens paquets 0.1.0+1 sont retirés.

### ⚠ Le paquet serveur ne démarrait pas — trouvé en le lançant (17/09, soir)

`node dist/main.js` échouait sur `Cannot find module …/packages/db/src/client.js` :
les paquets de l'espace de travail (`@elourwa/shared`, `@elourwa/db`) exportent
leurs **sources TypeScript**, que `node` seul ne résout pas. Le `start` de l'API
est désormais `node --import tsx dist/main.js` (`tsx` passe en dépendance de
production, de l'API et de `db` pour `migrate`/`seed`) ; vérifié : `/health`
et une connexion de famille sur le paquet construit, et `next start` sur le
site construit. Au passage, les clés ES256 passées par l'environnement d'un
conteneur (`
` littéraux) sont rétablies (`keys.ts` — le remplacement
précédent ne faisait rien).

### Héberger la démonstration gratuitement — `deploy/oracle/`

Décision du propriétaire (17/09) : **Oracle Cloud Always Free**. Le dossier
contient `Dockerfile` (API + site dans une image), `docker-compose.yml`
(Postgres 17, API, site, Caddy avec HTTPS automatique sur `*.<ip>.sslip.io` —
aucun domaine), `Caddyfile`, et `install.sh` (pare-feu de la VM, Docker,
`.env` tiré au sort, migration, mots de passe des rôles, graine, lancement).
Les mandataires ont des adresses fixes et sont dans `TRUSTED_PROXIES` ; Caddy
pose `X-Client-IP` pour l'application — sinon quinze mots de passe faux, de
n'importe qui, fermaient la porte à tous. `README.md` donne le parcours dans la
console Oracle, la commande, et la construction de l'`.apk` avec `API_URL`.
Non exécuté sur une vraie VM depuis ce poste (pas de Docker ici) : la première
installation réelle est à surveiller (`docker compose logs -f`).

`tools/packager.sh apk` produit `dist/parent-<version>.apk` (signé avec la même
clé que l'`.aab`, universel) — construit : `dist/parent-0.2.0+2.apk`.

### EN LIGNE — la démonstration gratuite (17/09, Render + Neon + DuckDNS)

Oracle a refusé le compte du propriétaire ; le déploiement s'est fait sur
**Render** (un service gratuit, `render.yaml`, conteneur `deploy/render/` :
API + site + mandataire Node), base **Neon** (Postgres 17, Francfort), noms
**DuckDNS** (`*.elourwa.duckdns.org` → 216.24.57.1, domaines ajoutés dans
Render, certificats émis). Dépôt : `github.com/25038-ux/elourwa` (privé),
Render redéploie à chaque `git push origin master`.

| | |
|---|---|
| Écoles | https://nour.elourwa.duckdns.org · rissala · salam (`admin@<école>.test`) |
| Console | https://admin.elourwa.duckdns.org (`admin@platform.test`) |
| API | https://elourwa-demo.onrender.com = https://api.elourwa.duckdns.org |
| Application | `dist/parent-0.2.0+2.apk`, API inscrite ; `30000000` = un parent, trois enfants, trois écoles |

Vérifié depuis ce poste sur le service vivant : santé, connexion de famille sur
les trois écoles (enfants, solde cumulé), connexion du directeur → tableau de
bord, connexion plateforme → console. Le gratuit s'endort après 15 minutes
(réveil ~1 minute) ; les secrets (clés ES256, URL Neon, `APP_USER_PASSWORD`)
ne sont que dans l'environnement Render.

⚠ Trois défauts de production trouvés EN DÉPLOYANT, jamais par les tests :
le paquet ne démarrait pas (`node` seul ne résout pas les sources TS des
paquets de l'espace de travail → `node --import tsx`) ; en production l'API
refusait `X-School-Slug`, or le site l'appelle sur 127.0.0.1 — chaque requête
du site échouait (accepté d'un pair de confiance, le pair étant la prise TCP,
pas X-Forwarded-For) ; la graine écrivait `payment_lines`, table remplacée
par 0014. Plus deux propres à l'hébergeur : Neon refuse « devpassword » à
`CREATE ROLE` (mots de passe par `APP_USER_PASSWORD`) et n'accorde pas
`BYPASSRLS` (0001 s'en passe sans superutilisateur) ; le binaire Caddy
d'Alpine est refusé par le bac à sable de Render (mandataire Node).

### Les défauts signalés après la démonstration (17/09) — ADR-0062

Onze points du propriétaire, tous traités et livrés (version 0.3.0+3 de
l'application) : exercice qui n'envoyait rien (limite d'action Next, `required`),
impayés notifiés en messagerie et non en notification, parents absents de
l'historique des connexions (session de famille sans école), premier mois dû
et modales de paiement (date hors fenêtre → tout est dû ; plus rien
d'obligatoire à l'encaissement), mois payés par membre du personnel (0037),
saisie des notes par le professeur (`/prof/notes`), vitesse (un `/auth/me`
par appel API supprimé, caches par requête), et l'application « comme
WhatsApp » (session qui survit au serveur endormi et aux changements de
réseau, sonnerie + vibration). ⚠ Deux sessions Claude ont travaillé en
parallèle sur ce dépôt ce soir-là : chacune n'a commité que ses fichiers.

### 18/09 — « Clôturer l'année » (ADR-0063) et la passe de vérification

Le message de clôture (et de « Rendre active ») se perdait : publié depuis un
effet dans une ligne que l'action remplace. Règle générale appliquée : les 37
formulaires publient au retour de l'action. Page des années alignée sur la
correction PHP (pas de contrôles morts sur une année close). API : cycle de
l'année couvert (`year-lifecycle.spec.ts`). Playwright : la suite « toutes les
pages » couvre désormais chaque `page.tsx` du disque (dont `/prof/notes`, les
reçus du soir) et un vrai professeur ouvre ses six pages et sa feuille.

### 18/09 (soir) — passe complète : année, identifiant, mot de passe, remise à neuf (ADR-0064)

- **L'année active est la seule source de vérité** : `defaultView()` rend
  l'année active (son `annee_defaut()` préférait l'année avec des données, et
  les tableaux ne suivaient pas une année qu'on venait d'activer).
- **Rendre active une année ultérieure clôture l'année en cours** (archivée) ;
  une année antérieure ouverte ne repasse plus « à venir » ; la confirmation
  l'annonce avec le nombre d'inscrits. `year-lifecycle.spec.ts` (7).
- **« Identifiant existe déjà » seulement s'il conflit dans cette école** ;
  un compte d'une autre école est rattaché, mot de passe intact.
  `createAccountAction` (mort-née, identifiant envoyé comme téléphone) retirée.
  Parcours mot de passe fixé par un test (créer → provisoire → changer →
  ancien refusé, nouveau accepté).
- **Remise à neuf** : locale faite (`reset` + `seed`, la reprise d'El Ourwa se
  rejouera avec `tools/import`) ; production par `deploy/render/reset-marker`
  (une fois par valeur), marque `2026-09-18-neuve-1` poussée.
- **Polish additif** du site (progression, messages, focus, tables, vides).
- Vérifié : api 837/837, shared 65, db 36, tools 18, Flutter 45/45,
  Playwright 81 + 19 rejoués verts (les échecs de la passe longue étaient le
  serveur de développement saturé par la suite API en parallèle).

### 19/09 — l'application des familles, version 0.4.0+5 (ADR-0065)

Notifications qui surgissent avec leur texte (canal `elourwa_v2`, carillon
propre, vibration, icône de barre d'état, ticker), permission demandée à
l'ouverture, sondage qui montre chaque nouveauté ; refonte de l'interface
(design system, coquille, tableau de bord, fil des notifications, états vides
et trames partout) vérifiée sans débordement à trois tailles d'écran.
Flutter 51/51.

### iOS — ce qu'il reste à faire, sur un Mac

Le projet est prêt (`apps/mobile/ios/`, identifiant `mr.elourwa.parent`,
`PrivacyInfo.xcprivacy`, entitlements push). Sur un Mac avec Xcode et Flutter :

1. `cd apps/mobile && flutter pub get && cd ios && pod install`.
2. Xcode → `Runner.xcworkspace` → Runner → Signing & Capabilities : l'équipe
   Apple (compte développeur, 99 $/an), Push Notifications, Background Modes
   → Remote notifications.
3. `tools/packager.sh ios` (ou `flutter build ipa --release --export-method
   app-store --dart-define=API_URL=https://api.<domaine> --dart-define=FIREBASE_…`)
   → `build/ios/ipa/*.ipa`.
4. Transporter (ou `xcrun altool --upload-app`) → App Store Connect → TestFlight
   puis soumission ; Firebase → Cloud Messaging → clé APNs (.p8) de l'équipe.
5. Les déclarations de confidentialité : `docs/legal/declarations-magasins.md`.

### Prochaine tâche

Le serveur de production (`docs/RUNNING.md` § 2 : domaine, `API_URL`, Firebase,
mots de passe de `app_user`/`app_reporter`), puis reconstruire l'application
avec `API_URL` avant de publier ; les deux points « à trancher » du 14/09
restent ouverts.

---

## L'AUDIT PAGE PAR PAGE CONTRE v23 EST TERMINÉ — 2026-09-14

Le propriétaire avait cru la parité à 100 % et a trouvé « Paiement du
personnel » différent de `paiement_staff.php` (ADR-0059). Depuis, chaque page
de `reference/v23` a été relue en entier — code, dynamiques, CSS, messages —
et la nôtre refaite à l'identique, page après page, un commit par page :
**`docs/parity/AUDIT-v23.md`** est la mesure (une ligne par page : « Refaite »,
« Retiré, car inventé », « Volontairement différent »), **ADR-0060** fixe ce
qui survit à la parité.

### Ce que ces trois sessions ont refait (55 commits)

- **Scolarité et comptes** : inscrire / réinscrire / réinscriptions, tableau
  de bord, comptes du personnel (une liste, trois panneaux, mot de passe
  provisoire en tête), gérer les professeurs, comptes des parents, créer un
  utilisateur, ajouter staff, recherche, messagerie, demandes (l'approbation
  EXÉCUTE), historique, statistiques (quatre cartes par sexe, LEFT JOIN sur
  niveaux et groupes), mon profil (prénom/nom, identifiant = `username`,
  mot de passe dans son ordre, session conservée), connexion (accueil par
  rôle, identifiant conservé, session expirée / déconnexion, ses phrases et
  seuils de verrouillage — **15 par adresse**).
- **Professeur** : tableau de bord (icônes, heures × 4 × tarif, enseignements
  courants par niveau avec effectif et notes saisies), mes classes,
  emploi du temps, envoyer un exercice (refus dans son ordre, fichiers validés
  AVANT l'insertion avec ses phrases, destinataires de l'année consultée),
  remarques (élèves des groupes enseignés, anti-IDOR).
- **Espace des familles** (Flutter + `/parent/*`) : connexion tolérante au
  format du numéro et ses phrases (`espace: parent`), changement de mot de
  passe dans son ordre et **la session survit**, bulletin = le MÊME document
  que la direction (`reportCardFor`) avec sa porte (devoirs gardés, examen et
  moyenne blanchis, son avis bilingue), remarques bornées à l'année, enfants
  par nom.
- **Supprimé, car sans contrepartie** : `/my-week`, `/settings`, `/reports`,
  `/today`, `/accounts`, `/classes`, `/students` (liste).
- **Rien à porter** : quatre redirections de `super_admin/`, six `api/*.php`
  sans appelant.

### Vérifié

| Moyen | Résultat |
|---|---|
| `tsc` api · web | ✓ · ✓ |
| `vitest` api | **805 / 805** ✓ (73 fichiers) |
| `flutter analyze` · `flutter test` | ✓ · 40 / 40 |
| Navigateur, page par page, contre les serveurs vivants | chaque page vérifiée à la main pendant l'audit (messages, refus, dynamiques) |
| `pnpm reconcile` — 91 mesures sur les données réelles | **91 / 91** ✓, code 0 — après la réparation ci-dessous |
| Playwright, site du personnel, contre les serveurs vivants | **76 / 76** ✓ (1 reprise : première compilation d'une route) — dix tests écrits contre NOS anciennes pages ont été réécrits contre les siennes ; `e2e/session.ts` réécrit l'état de session après chaque test (le jeton de rafraîchissement tourne : deux contextes qui présentent le même sont une réutilisation, et toute la famille tombait au quart d'heure) |
| `next build` (emballage) | ✓ toutes les routes |

### ⚠ Six notes reprises avaient été arrondies au quart de point — dans NOTRE base

La réconciliation du 14 trouvait la somme des notes plus courte de 0,30 :
six notes d'El Ourwa (7,80 · 10,20 · 7,58 · 15,60 · 17,80 · 14,57) valaient
chez nous 7,75 · 10,25 · 7,50 · 15,50 · 17,75 · 14,50 — `origin = migrated`,
`recorded_at` d'origine, donc un UPDATE direct, dont aucun journal ne porte
la trace (aucune écriture de notes sur `elourwa` dans `audit_log`, aucun code
qui arrondit, le rapport du 11 les avait justes). Le seul indice : le commit
4727c2a (13/09) note dans la graine « au quart de point, comme les 50 000
notes réelles (une seule exception dans la reprise) ». **Restaurées depuis la
référence** (script ponctuel, six lignes, par `legacy_id`) ; 91/91. El Ourwa
avait raison (règle 26) — et une donnée reprise ne se « corrige » jamais à la
main, même quand elle paraît étrange (règle 24).

### ⚠ Pièges rencontrés, pour le suivant

- **React ne déclenche pas une action de formulaire quand un champ `required`
  est vide**, même sous `noValidate` : les refus serveur d'El Ourwa ne sont
  atteignables qu'en retirant `required` là où il les attend.
- **Un message publié par effet se perd** quand le composant qui le porte
  disparaît (suppression) ou change d'ordre (désactivation) : publier AU
  RETOUR de l'action (`useActionMessage`, `useActionPubliee`).
- **Un accent grave dans un commentaire SQL** à l'intérieur d'un gabarit
  TypeScript casse la compilation — même dans `-- …`.
- **Le jeton d'accès porte le sceau du mot de passe** : après un changement,
  la session ne survit que si le jeton de rafraîchissement est épargné ET
  renouvelé tout de suite (site et application le font).

### À trancher par le propriétaire

- Le tableau de bord du professeur affiche **heures × 4 × tarif horaire même
  pour un permanent** — c'est sa formule, reproduite ; un permanent sans tarif
  lit « 0 MRU ». Garder tel quel, ou afficher le salaire fixe ? (ADR-0060.)
- La reprise n'importe pas `personnel_admin` (collision d'entiers avec
  `staff`) : la carte « Administrateurs » de `/statistiques` ne compte que les
  comptes créés ou modifiés chez nous.

### Emballé de nouveau (14/09)

`dist/serveur-0.1.0+1.tar.gz` (API + site, construit en production),
`dist/parent-web-0.1.0+1.tar.gz`, `dist/parent-0.1.0+1.aab` (23,4 Mo, signé).
Les réserves du 12 tiennent (pas de serveur de production, Firebase à créer,
juridique à relire, iOS sur macOS). ⚠ `tools/packager.sh` déclarait le SDK
Android absent alors qu'il est là : `grep -q` sous `pipefail` coupe le tube
avant la fin de `flutter doctor` — `grep` lit désormais jusqu'au bout.

### Prochaine tâche

Les deux points « à trancher par le propriétaire » ci-dessus ; puis, s'il le
demande, la reprise de `personnel_admin` (un `legacy_table` ou un décalage
d'entiers pour éviter la collision avec `staff`).

---

## VÉRIFIÉ PAR TOUS LES MOYENS, ET EMBALLÉ — 2026-09-12

Le propriétaire a demandé une vérification « par tous les moyens possibles, pas
seulement des en-têtes » et l'emballage des deux applications. C'est fait, et la
vérification au navigateur a trouvé ce que 828 tests verts n'avaient pas vu.

### Ce qui a été vérifié

| Moyen | Résultat |
|---|---|
| `pnpm typecheck` (5 paquets) | ✓ |
| `pnpm test` — tools 18, shared 63, db 36, api 750 | **867 ✓** |
| `pnpm reconcile` — 88 mesures sur les données réelles | **88/88 ✓**, code 0 |
| `flutter analyze` · `flutter test` | ✓ · 40/40 |
| Playwright, site du personnel, contre les serveurs vivants | **44/44** ✓ |
| `pnpm audit --prod` | aucune vulnérabilité (dev : vite/esbuild, non livrés) |
| Sondes API : rôles, énumération, cloisonnement, limitation, en-têtes | ✓ |
| **Navigateur, à la main** : connexion comptable, tableau financier, Finance ; pages légales FR/AR ; espace parent — bascule AR avant connexion, connexion, restauration silencieuse, résultats retenus (ADR-0025), profil, suppression de compte | ✓ après corrections |

### ⚠ Ce que le navigateur a trouvé, que les tests ne voyaient pas

1. **Aucun parent ne pouvait se connecter depuis l'application.** `login()`
   exigeait `200` ; l'API répond `201` à tout POST, et l'a toujours fait. Chaque
   connexion réussie était rejetée comme « identifiants incorrects » — jeton en
   main. Même chose sur `refresh()` : la session gardée ne se restaurait jamais.
   Les tests de widget répondaient 200 en simulant. **Corrigé, vérifié.**
2. **Un rôle exigé seul ne comptait pour rien.** Le garde rendait `true` dès
   qu'aucune permission n'était nommée, avant de lire le rôle. `/parent/children`
   répondait 200 au directeur. Corrigé ; `@RequireRole('parent')` sur tout
   l'espace parent ; douze tests.
3. Le profil changeait de sens sans changer de langue (`lang` figé à l'ouverture
   de la route). La boîte « Supprimer mon compte » débordait de l'écran. La page
   légale arabe laissait `<html lang="fr" dir="ltr">`. **Tous corrigés.**
4. La suite `db` échouait sur « No test files found » : Windows réserve des plages
   de ports qui bougent à chaque redémarrage, et 54329 était dedans ce matin.
   Sept candidats espacés, le premier qui se lie gagne.

### ⚠ Le poste, pas le code : deux pièges d'infrastructure

- **`Unable to establish loopback connection`** (Gradle). Le `Pipe` de la JVM
  préfère AF_UNIX et met son fichier dans `%TEMP%` ; ici `%TEMP%` est en forme
  courte 8.3 (`SIDIBR~1`) et afunix.sys refuse la connexion. Le JDK ne retombe
  sur TCP que si le *bind* échoue. `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Java\tmp`
  — dans `tools/packager.sh`, et à mettre dans le profil du poste.
- **Deux `curl` sur le même fichier** ont rendu une archive de 181 Mo pour 153
  attendus. Une seule écriture par fichier, et `unzip -t` avant d'installer.

### Emballé

| Paquet | Où | État |
|---|---|---|
| API + site | `dist/serveur-0.1.0+1.tar.gz` | ✓ construit en production |
| Parent, version web | `dist/parent-web-0.1.0+1.tar.gz` | ✓ avec la correction de connexion |
| Parent, Android | `dist/parent-0.1.0+1.aab` | ✓ 23 Mo, signé (CN=El Ourwa), `bundletool validate` OK, 4 ABI, targetSdk 35 |
| Parent, iOS | — | projet prêt ; s'archive sur macOS (`tools/packager.sh ios`) |

**Il n'y a pas encore de serveur de production.** Le `.aab` embarque donc
`localhost` comme adresse par défaut, ET une porte pour la changer : sous le
formulaire de connexion, « Serveur : … · modifier », HTTPS seulement, visible.
Le jour où `https://api.<domaine>` existe, il se saisit là — ou le paquet se
reconstruit avec `API_URL=…`. Les deux fichiers de signature
(`elourwa-release.jks`, `key.properties`) sont sur ce poste, ignorés par git :
**à sauvegarder hors du poste, chiffrés.**

### Ce qui reste à faire par une personne

- Le juriste : relire `content/legal/*` et remplir les `[À COMPLÉTER]`.
- Firebase : créer le projet, fournir `FCM_SERVICE_ACCOUNT` au serveur et les
  `FIREBASE_*` à la construction — sans eux l'application interroge au lieu de
  recevoir, et le dit au démarrage.
- Un Mac pour l'archive iOS.
- Le domaine de production, puis `API_URL=… tools/packager.sh android`.

---

## PRÊT POUR LES MAGASINS — 2026-09-11

`FEATURES.md` : **aucune ligne ouverte.** Les cinq ☐ sont faites (push, langue
mémorisée ×2, cache, total arabe = rien à porter), les six ◐ vérifiées contre le
code et fermées. **ADR-0058.**

| | |
|---|---|
| Tests | 56 shared · 18 tools · 36 db · 748+ api · 40 Flutter — tous verts |
| Réconciliation | 88 mesures, code 0 |
| `pnpm audit --prod` | aucune vulnérabilité connue (`fastify` forcé ≥ 5.12.1) |
| Secrets dans le dépôt | aucun |
| Emballé ici | `dist/serveur-0.1.0+1.tar.gz` (2,1 Mo), `dist/parent-web-0.1.0+1.tar.gz` (7,8 Mo) |
| **Pas emballé ici** | le `.aab` (pas de SDK Android sur ce poste) et le `.ipa` (macOS seulement) — projets prêts, `tools/packager.sh` dit ce qui manque |

⚠ **LE JETON DISAIT QUI VOUS ÉTIEZ ; LA BASE DIT QUI VOUS ÊTES.** `AuthGuard`
faisait confiance au jeton pendant quinze minutes — rôles, permissions, et le
fait même que le compte existât. Désormais, par requête : compte actif, sceau du
mot de passe, permissions relues. Un mot de passe changé tue le jeton à la
requête suivante. Empreinte de session sur le rafraîchissement. Suppression de
compte par anonymisation, écritures conservées. `docs/SECURITY.md`.

⚠ **LE JURIDIQUE N'EST PAS RELU.** Politique et conditions en FR et AR à
`/legal/…`, déclarations des magasins dérivées du code. Les `[À COMPLÉTER]`
sont des faits sur l'école — raison sociale, adresse, hébergeur, durées légales,
autorité de contrôle — et **doivent** être remplis par elle, puis relus par un
juriste. `docs/legal/declarations-magasins.md` liste aussi ce que l'école doit
fournir : comptes développeur, projet Firebase, clé de signature, un Mac.

⚠ **`mr.elourwa.parent` ne change plus après la première publication.** Si
l'identifiant doit être autre chose, c'est avant de soumettre.

### Ce qui reste

- Remplir et faire relire le juridique ; obtenir domaine, Firebase, clé Android,
  comptes développeur ; archiver iOS sur un Mac.
- Question ouverte d'ADR-0054 : prévenir les familles dont le bulletin portait
  « −1.00 » ?
- Le cours du soir, les absences, l'emploi du temps sont vides dans la
  référence : rien à reprendre ni à réconcilier aujourd'hui.

---

## LA REPRISE EST COMPLÈTE — 212 196 lignes, 88 mesures, la dette identique, 2026-09-11

Finance, paie, dettes constatées, et la dette de scolarité **calculée** —
tout ce qui restait. La reconciliation est l'épine dorsale du projet, et elle
tient de bout en bout.

```bash
npx tsx tools/import/creer-branche.ts elourwa "El Ourwa" ELOU
pnpm importer --school elourwa                              # 70 s
"C:\wamp64\bin\php\php8.5.0\php.exe" tools/reconcile/extraire-dettes.php > tools/reconcile/data/dettes-elourwa.jsonl
pnpm --filter @elourwa/api extraire-dettes elourwa
pnpm reconcile                                              # 88 mesures, code 0
```

| | El Ourwa | Nous |
|---|---|---|
| Encaissé | 42 614 000.00 | **42 614 000.00** |
| Restant dû sur l'échéancier | 34 479 000.00 | **34 479 000.00** |
| Salaires attribuables | 30 853 394.00 | **30 853 394.00** |
| Dettes constatées | 10 668 700.00 | **10 668 700.00** |
| **Dette réclamée aux familles** | **1 714 200.00** | **1 714 200.00** |
| — famille par famille | condensé c6dc2d74… | **identique** |

⚠ **LA DETTE A DIVERGÉ DE VINGT FOIS À LA PREMIÈRE PASSE.** 34 038 500.00 chez
nous, 1 574 000.00 chez lui. Sa règle ne compte que l'année scolarisée — les
arriérés passés sont CONSTATÉS dans `dettes_familles`, et les recompter les
ferait payer deux fois — et exempte les mois d'avant l'entrée de l'élève.
`DebtService` s'aligne, l'import traduit l'exemption en état (414 mois `free`),
cinq tests posent la règle. **ADR-0057** raconte les trois points.

⚠ **Le propriétaire a tranché : système neuf.** On ne demande plus s'il faut
porter chaque colonne héritée. Trois migrations accordées en chemin : `username`
(0027), `payment_methods.origin/legacy_id` (0028), `(school_id, legacy_id)`
unique partout (0029 — la reprise était passée à dix minutes faute d'index).

⚠ **Deux trous, chiffrés et sans effet sur la dette** : les frais annuels
suivis par inscription chez lui et par famille ici (ses barèmes valent zéro,
donc rien n'entre dans le calcul), et 339 bulletins de salaire sans personne
derrière — 1 245 990.00 hérités de l'ancien logiciel, montrés à part.

### Ce qui reste

- Le cours du soir (`cs_*`), les absences, l'emploi du temps, les demandes :
  **toutes vides** dans la référence. Rien à reprendre aujourd'hui.
- Les cinq lignes de `FEATURES.md` : notifications push, interface arabe/RTL,
  cache, total arabe fondamental.
- **Une question ouverte** (ADR-0054) : prévenir les familles dont le bulletin
  portait « −1.00 » ?

---

## LES NOTES SONT REPRISES — 147 331 lignes, 42 mesures, 2026-09-10

Deuxième tranche : formules du bulletin, personnel, professeurs, enseignements et
les **139 457 notes**. Avec la première, la reprise écrit maintenant 147 331
lignes en une douzaine de secondes, et se relance sans rien créer.

```bash
pnpm importer --school elourwa --dry-run
pnpm importer --school elourwa
pnpm reconcile                      # 42 mesures, code 0
```

| | El Ourwa | Nous |
|---|---|---|
| Notes | 139 457 | **139 457** |
| Notes par élève, matière et trimestre | condensé identique | **id.** |
| Marqueurs d'absence | 1 580 | **1 580** |
| Somme des notes réelles | 1 431 819.30 | **1 431 819.30** |
| Enseignements · formules | 504 · 60 | **504 · 60** |

⚠ **La mesure qui compte descend au triplet (élève, matière, trimestre).**
« 139 457 des deux côtés » ne prouve rien : deux notes interverties entre deux
élèves laissent le total intact et changent deux bulletins.

⚠ **Et cette mesure ne peut pas s'imprimer.** Son empreinte fait 663 770
caractères de `100:126:1=2|…`, où ces nombres sont des identifiants d'enfants —
alors que le rapport daté est versionné et promet de n'en porter aucun. Elle
compare donc deux condensés, et les clés fautives ne sortent qu'à la console avec
`--verbose`. **ADR-0056.**

⚠ **`bulletin_formules.mode_calcul` est déclaré, rempli 60 fois, et jamais lu** —
`grep -rn` sur tout son source ne trouve rien. Le même motif que les permissions
financières d'ADR-0053. Non repris : les coefficients d=0 / e=1 **disent** déjà
« examen seul », et c'est l'explication complète du « −1.00 » d'ADR-0054.

⚠ **`checks/commun.ts` est désormais testé** (18 tests). Il décide ce qu'on
appelle « la même répartition » ; une barrière qui ne sait pas échouer n'est pas
une barrière.

### ⚠ Le propriétaire a tranché : c'est un SYSTÈME NEUF

« all the data is irrelevant what we're building here is a fresh system »
(2026-09-10). La reprise sert à prouver que les calculs concordent, pas à
préserver chaque colonne héritée. **On ne demande plus** s'il faut porter un
second téléphone ou un matricule interne : s'il n'a pas de place dans un modèle
propre, il n'en a pas.

Ce qui a été accordé explicitement : **`users.username`** — fait, migration 0027.
Le personnel se connecte avec son nom d'utilisateur, son adresse ou son numéro,
les trois uniques, `username` sur `lower(username)`.

### La suite

`checks/finance.ts`, `checks/debts.ts`, `checks/payroll.ts` — chacune attend sa
tranche d'import : paiements, dettes, paie, puis le cours du soir.

---

## LA REPRISE TOURNE — 7 304 lignes, réconciliées, 2026-09-08

`tools/import` était un échafaudage — un README et rien d'autre — et il bloquait
les quatre vérifications de réconciliation restantes, qui comparent des totaux de
part et d'autre. Il tourne.

```bash
npx tsx tools/import/creer-branche.ts elourwa "El Ourwa" ELOU
pnpm importer --school elourwa --dry-run     # dit tout, n'écrit rien
pnpm importer --school elourwa
pnpm reconcile --only students
```

**Ce qu'il reprend**, dans l'ordre des dépendances : configuration, années, mois
réellement facturés, niveaux, groupes, matières, correspondants, élèves,
inscriptions. **Ce qu'il ne reprend pas encore** : notes, paiements, dettes, paie,
cours du soir — elles dépendent toutes de cette première tranche.

| | |
|---|---|
| Lignes écrites | **7 304** |
| Relancé : créées / mises à jour | **0 / 7 304** — idempotent |
| Mesures réconciliées | **24** |
| Divergences | **0** |

Les cinq sommes d'argent tombent au centime : 8 593 000.00 de frais mensuels,
9 374 500.00 de tarifs pleins, 431 500.00 d'inscription, 286 000.00 de document.

⚠ **Il REFUSE une branche qui n'est pas vierge.** Lancé sur « École Nour », il
s'est heurté à la contrainte d'unicité des années — la semée et la reprise. La
contrainte avait raison : mélanger 2 153 dossiers réels aux 200 élèves inventés
d'une branche de démonstration rendrait tout total indéfendable. D'où la branche
`elourwa`, et **ADR-0055**.

⚠ **Ce qui n'a pas de destination est compté, pas perdu de vue** : 128 seconds
téléphones, 40 seconds noms, 7 NNI de parents, 2 153 matricules internes. Le
journal les nomme à chaque passage. **Question à l'école** : les seconds
téléphones servent-ils à joindre les familles ? Si oui, il faut des colonnes,
donc une migration, donc une demande (règle 16).

⚠ **Un piège dans la vérification, pas dans les données** : El Ourwa est en
`utf8mb4_unicode_ci` et replie « NKT », « Nkt » et « nkt » dans un seul groupe ;
Postgres regroupe exactement. Les empreintes divergeaient alors que les valeurs
étaient identiques — 95 + 13 + 4 = 112, le chiffre même de `CLAUDE.md`. Tout
regroupement sur du texte est désormais forcé en `utf8mb4_bin`.

⚠ **`tools/` est devenu un vrai paquet de l'espace de travail.** Il déclare ses
pilotes (`mysql2`, `pg`) au lieu de compter sur le hasard du hissage, et il passe
désormais par `pnpm typecheck` comme le reste — en `strict` et
`noUncheckedIndexedAccess`.

### La suite

Les quatre vérifications restantes ont désormais des données des deux côtés :
`checks/finance.ts`, `checks/debts.ts`, `checks/payroll.ts`, et les notes. Chacune
demande d'abord sa tranche d'import.

---

## LA RÉCONCILIATION TOURNE — première passe, 2026-09-08

`tools/reconcile` était un échafaudage depuis le début, alors qu'il se décrit
lui-même comme « l'épine dorsale du projet ». Il tourne.

**Comment.** `extraire.php` appelle le `bulletin_donnees()` d'EL OURWA, sur SA
base, avec SES formules ; nous rejouons les mêmes entrées à travers
`@elourwa/shared` et comparons en chaînes. C'est lui qui calcule le côté
« legacy » — transcrire son arithmétique reviendrait à tester ma transcription.

**Le résultat**, année 2025-2026, 3 011 bulletins :

| | |
|---|---|
| Moyennes de matière identiques | **21 612 / 21 789** |
| Divergences | 177 — **toutes** avec un marqueur d'absence |
| Divergences sans marqueur | **0** |

Le zéro est le résultat : sur chaque note qui n'est pas un marqueur, nous rendons
le chiffre d'El Ourwa au centième près.

⚠ **Les 177 sont son défaut, mesuré.** `notes.valeur = -1` est le marqueur
d'absence — 1 580 lignes réelles — et il ne le filtre nulle part. Sur les niveaux
en `examen_seul`, la moyenne devient « −1.00 » sur un bulletin remis à une
famille. C'est la règle 11, chiffrée. **ADR-0054**, et une question posée à
l'école : faut-il prévenir les familles dont le bulletin portait « −1.00 » ?

**Pour relancer :**

```bash
php tools/reconcile/extraire.php > tools/reconcile/data/bulletins.jsonl
pnpm reconcile
```

⚠ Le laboratoire de référence se relance sans élévation :
`mysqld.exe --defaults-file=C:\wamp64in\mysql\mysql8.4.7\my.ini --console`
en tâche de fond (les SERVICES wamp, eux, demandent l'élévation).

---

## LE REGISTRE DISAIT FAUX — audit du 2026-09-07

`docs/FEATURES.md` portait **52 lignes ☐**. Vérifiées une à une contre le code :
**45 étaient bâties**, et la 46ᵉ (suspendre une branche) a été bâtie dans la
foulée parce que l'audit a montré que la console en affichait déjà l'état.

La couche plateforme était la plus mal décrite : créer une branche, y nommer un
administrateur, y entrer sans se reconnecter, le rapport consolidé et la
configuration par branche sont bâtis et testés — huit lignes marquées « pas
commencé ».

⚠ **Un registre qui annonce « pas commencé » sur des fonctions livrées est pire
qu'aucun registre.** Il noie les quelques lignes qui ne sont vraiment pas faites,
et « `FEATURES.md` still lists unported rows » est resté en tête de ce fichier
pendant des sessions sans que personne ne regarde lesquelles.

**Ce qui reste, cinq lignes :** les notifications push (l'application parent
interroge au lieu de recevoir), l'interface web en arabe avec RTL (l'application
parent l'a, le personnel non), la couche de cache (jamais commencée, rien ne la
réclame), et le total arabe du fondamental (comportement hérité, à trancher à la
réconciliation).

---

## LES 39 PAGES — TROIS BALAYAGES MÉCANIQUES, 2026-09-07

Après les autorisations, un balayage des 39 pages vivantes d'El Ourwa (43 moins
quatre redirections), trois fois, par une méthode différente à chaque passe. Le
laboratoire de référence étant éteint (les services WAMP demandent une élévation
que je n'ai pas), tout a été comparé depuis la SOURCE — qui fait foi de toute
façon (règle 19).

### Passe 1 — les actions

Les **114 actions POST** relevées sur les 39 pages, chacune cherchée dans notre
code. Une trentaine ne se trouvaient pas par leur nom ; la plupart étaient des
faux positifs — `toggle_actif` s'appelle `ActiveForm`, `effacer_case` est
`DELETE /timetable/group/:id`, `cloturer` est `POST years/:id/close`,
`ajouter_etudiants` est désactivé chez lui aussi. **Trois étaient réelles :**

- retirer un élève de sa classe (`supprimer_etudiant`) — absent ;
- supprimer un professeur (`supprimer_professeur`) — absent ;
- et « Voir étudiants » était un **lien mort** : il passait `?group=` à un écran
  qui ne lit pas ce paramètre, donc il ouvrait la liste de toute l'école.

### Passe 2 — les colonnes

Les en-têtes de toutes les tables. Onze absences sur l'ensemble, dont dix sont
des variantes d'écriture — nos colonnes du paiement des professeurs du soir en
portent d'ailleurs **plus** que les siennes. **Une était réelle :** sa colonne
« Mois payés », un bandeau de pastilles montrant l'année entière sur la ligne
d'un inscrit, là où nous n'affichions qu'un mois à la fois.

### Passe 3 — les titres et les libellés

Titres de section, libellés de KPI et de formulaire. **Un écart réel**, et il en
cachait un pire : ses deux formulaires d'inscription au cours du soir étaient
regroupés chez nous en un seul avec un sélecteur (ADR-0048, troisième
occurrence) — mais surtout **sa recherche d'étudiant manquait**. Une déroulante
nue sur 2 153 élèves.

### Ce que ces trois passes disent de la méthode

Les défauts trouvés ne sont plus des pages entières mais des **capacités
ponctuelles** : un bouton, une colonne, une case de recherche. La comparaison
mécanique les trouve ; la lecture à l'œil ne les trouvait pas, parce qu'un écran
qui rend 95 % de ce qu'il doit rendre a l'air juste.

⚠ **Et le vrai défaut se cache souvent derrière un écart cosmétique.** Le
regroupement des deux formulaires était sans conséquence ; c'est en allant le
défaire qu'on trouve la liste sans recherche, qui rendait l'inscription pénible
à chaque usage.

---

## ⚠ LES AUTORISATIONS — BALAYAGE COMPLET, 2026-09-07

Consigne du propriétaire : « everything as elourwa does, every permission ».
Balayage de TOUTES les gardes d'El Ourwa — `require_role`, `exiger_permission`,
`est_comptable()`, `est_secretaire()`, `$peut_administrer_frais` — page par page.

### Ce que le balayage a établi d'abord

**Le catalogue et la distribution étaient déjà exacts.** Les 24 permissions et
les six rôles correspondent à son `role_permissions` (`role-grants.spec.ts` le
tient depuis une session précédente). Il n'y avait rien à corriger là.

**Mais El Ourwa n'applique pas ses permissions financières.** `finance.dette`
figure dans son catalogue, il l'accorde au comptable — et la chaîne n'est
vérifiée NULLE PART dans tout v16. Ce qui garde réellement ces gestes est le
RÔLE : `$peut_administrer_frais = a_role('super_admin') || a_role('admin')`,
doublé d'un refus nominatif du comptable action par action. Nous avions recopié
la distribution sans l'application.

### Corrigé (trois commits)

| | |
|---|---|
| 18 routes de dette | `@RequireRole('super_admin','admin')` en plus de la permission — exemptions, réductions, remises, frais annuels, moyens de paiement, annulation de paiement, réductions du soir |
| Annuler une dépense | même garde — « la suppression d'une dépense est réservée à l'administration » |
| Enregistrer une dépense | le comptable dépose une **demande**, il n'écrit plus directement |
| Tarif mensuel à l'inscription | comptable et secrétaire voient leur montant **substitué** par le tarif du niveau, avec demande à l'administration |
| Onglet « Administrateurs » | masqué partout (une page l'oubliait) et la page refuse désormais le comptable |
| Montants de plafond | ne partent plus sur le réseau pour le comptable — l'ÉTAT oui, les CHIFFRES non |

Le refus dit où aller, comme le sien : « Soumettez une demande depuis
"Demandes". » La file existe et le comptable la traite lui-même.

Deux fichiers de tests écrits avant les correctifs (règle 15) :
`caisse-direction-only.spec.ts` (28) et `tarif-officiel.spec.ts` (7).

### Tranché : payer le personnel, et le reprisage des mois réglés

Les deux dernières divergences sont fermées, comme El Ourwa les fait.

**Le comptable paie le personnel.** `paiement_staff.php` et `dette.php` sont
gardées par `require_finance_page()`, qui l'admet, et aucune de leurs actions ne
le refuse. `finance.salaires` y est déclarée, distribuée, jamais lue — comme
`finance.dette`. Le contrôleur de paie accepte donc `finance.consulter` en
second. Lui restent fermés : les fiches de porteurs de fonds, les montants de
plafond, la page « Administrateurs », et le tarif d'un professeur.

**Un changement de tarif reprise tous les mois**, y compris réglés. El Ourwa n'a
aucun prix stocké par mois et ne peut pas faire autrement ; nous épargnions les
mois payés, ce qui écartait nos totaux annuels des siens sur toute famille dont
le tarif change en cours d'année. Le risque de réconciliation est levé.

> ⚠ **RENVERSÉ LE 2026-09-08 — ADR-0054.** La prémisse était fausse : El Ourwa
> **a** un prix par mois, `inscription_mois.montant_du`, rempli sur 11 896 mois
> et **relu par personne**. Il pouvait épargner un mois réglé ; il ne le faisait
> pas. Mesuré chez lui : 43 mois réglés exposés, 18 familles, 113 500 MRU déjà
> encaissés, et une hausse de 500 MRU y créait 21 500 MRU de dette sur des mois
> payés. Sa v20 lit désormais ce montant et épargne les mois réglés ; nous
> faisons de même. **Les deux systèmes épargnent les mêmes mois** — la
> réconciliation est tenue par l'alignement, pas par la reprise.
>
> Et le même balayage a trouvé plus grave à côté : ses quatre écrans de
> changement de tarif n'écrivaient que `etudiants.frais_mensuel`, quand tout
> calcul lit `etudiant_inscriptions.frais_mensuel` — **934 inscriptions sur 934
> en portent un**. L'écran annonçait « mis à jour » et l'argent réclamé ne
> bougeait pas.

⚠ **Leçon à garder.** Ouvrir la paie au comptable a révélé un 500 : la jauge des
porteurs de fonds divisait par un plafond que nous venions de retirer de la
réponse. Retirer une information sans regarder qui s'en servait casse l'écran de
la personne qu'on voulait protéger.

⚠ **CONSIGNE PERMANENTE DU PROPRIÉTAIRE (2026-09-07)** : lire El Ourwa et le
reproduire, sans demander. Les écarts se documentent, ils ne se décident pas.

---

## Ce que cette session a trouvé — 2026-09-06

La première passe de parité avait comparé les 57 pages d'administration. Elle
n'avait touché ni l'espace professeur, ni l'espace parent, ni les documents
imprimés. Les trois en avaient besoin.

**L'espace professeur** (`pages/professeur/`, 5 pages réelles — la sixième,
`saisir_notes.php`, n'est plus qu'une redirection) :

- un enseignant **ne pouvait pas voir sa propre paie**. Son tableau de bord porte
  « Tarif horaire » et « Salaire mensuel » ; le nôtre n'en disait rien ;
- il **ne pouvait pas voir qui est dans sa classe**. « Voir les étudiants »
  déplie la liste chez lui ; nous offrions un lien « Notes » vers un écran
  d'administration qu'il n'a pas le droit d'ouvrir ;
- **les pièces jointes d'un exercice n'étaient pas branchées** — la table,
  le téléversement et le téléchargement gardé existaient, le champ jamais rendu.

**L'espace parent** (`pages/parent/`, comparé à `apps/mobile`) :

- **la fiche d'un enfant montrait les absences et les remarques des autres** :
  ses onglets appelaient les feeds familiaux ;
- son compteur d'absences **n'était borné par aucune année**, et **ne comptait
  pas les retards** là où El Ourwa compte `absent` **et** `retard` ;
- sa carte d'en-tête ne portait **aucun des deux grands chiffres** — absences,
  moyenne — que le parent vient chercher ;
- **les pièces jointes n'arrivaient pas jusqu'à la famille**.

**Les documents imprimés** :

- **nous imprimions un autre bulletin que le sien.** Le sien est le formulaire
  d'État mauritanien — en-tête tricolonne, république et ministère dans les deux
  langues, grille bilingue, récapitulatif des trimestres, seuil, décision
  « Admis / Ajourné », signatures, « document non valable sans signature ». Le
  nôtre était une feuille de mon invention. `bulletin.css` était porté et
  chargé depuis le début ; rien ne s'en servait ;
- le bulletin d'une classe et celui d'un enfant sont **le même document** chez
  lui ; les nôtres étaient deux mises en page recopiées, déjà divergées.

**La caisse et les dettes** :

- **« Nouvelle dette » a été retirée par l'école, et nous l'avions remise** —
  « l'école ne prête qu'à son PERSONNEL », dit son commentaire ;
- la grille de mois d'un prêt ne couvrait **qu'un an** là où il annonce « 1, 2,
  3 ans ou plus », et ses mois étaient tronqués à quatre caractères sur un
  échéancier de retenue sur salaire.

**Leçon de méthode.** Trois de ces défauts venaient d'un jugement de ma part
contre une consigne explicite de réplication (le panneau de concessions
regroupé, le formulaire de prêt déplacé, le bulletin redessiné). Quand la
consigne est « réplique », arbitrer est une erreur même quand l'arbitrage se
défend.

---

## Right now

| | |
|---|---|
| **Phase** | Parity sweep against `reference/v16/` — **reopened and extended** to the spaces the first sweep never covered: the six teacher pages, the nine parent pages against the Flutter app, and the printed documents. |
| **Status** | **Green.** 876 API · 86 shared · 57 Flutter · 36 db · 18 tools · 47/48 pages à 375 px. Marque + école unique livrées (ADR-0069), balayage du 22/09 corrigé (ADR-0070), Firebase créé et vérifié (ADR-0069, FIREBASE.md), El Mourad emballé (`dist/elmourad-0.7.0+9.zip`, `dist/elmourad-parent-0.7.0+9.apk`). |
| **Next task** | Étendre la réconciliation (effectifs, finance, dettes, paie) — elles attendent `tools/import` · les 5 lignes de `FEATURES.md` qui restent |
| **Blocked on** | Rien. Before cutover: set `SMTP_HOST`, schedule `scripts/backup.sh`, test a restore. |

```
  @elourwa/shared                56   money, absent marker, both bulletin regimes,
                                      when to renew an access token, and the
                                      admission verdict — including the rule that
                                      an unmarked pupil is « Non évalué » and never
                                      « Ajourné »
  @elourwa/db                    36   RLS isolation, a control experiment, and the
                                      guard that stops the suite wiping a real database
  @elourwa/api                  718   tender ledger, exam access, accounts, payroll,
                                      level admin, annual fees, the parent stream,
                                      the re-enrolment gate and its four terms, the
                                      evening grid, the withdrawal report and its
                                      ventilation, the two fiches of `recherche.php`
                                      across a tenant boundary, and the two deletes
                                      that used to take the grades and the salaries
                                      with them; plus three guards: no backtick in
                                      a SQL literal, no permission that nobody holds,
                                      no composite key that nulls its own school_id
  flutter test                   34   + El Ourwa's own words, both languages,
                                      and the two ways a session used to be lost
  playwright                     42   browser, three branches, permissions, and the
                                      two controls that moved the URL and did nothing
```

`TEST_PG_PORT` overrides the API suite's Postgres port. A killed run can leave
the socket bound to a dead PID, and the next run then reports **no tests** rather
than a failure — which reads as a broken suite and is a stuck port.

⚠ **AND SOME PORTS ARE RESERVED BY WINDOWS, with the same silent symptom.**
`TEST_PG_PORT=55090` gave "no tests" three times running; the embedded Postgres
had logged `could not bind IPv4 address "127.0.0.1": Permission denied` and
`could not create any TCP/IP sockets`, which vitest's summary never shows. The
range 55060–55159 is excluded on this machine, along with 50000–50059,
56207–56306, 58973–59072 and 61558–61657:

```bash
netsh interface ipv4 show excludedportrange protocol=tcp
```

Pick a port outside every listed range — 54210 works — and read the Postgres
lines, not the vitest summary, when a run says it found nothing.

⚠ **THE RICHEST SEAM THIS SESSION WAS "WRITTEN AND NEVER READ".** Four separate
defects came out of the same question — *does anything consume this?*

| What | Symptom |
|---|---|
| `notifications` | Written since homework shipped, no reader anywhere. Families were never told anything. |
| `?annee_id=` | The year selector on **every** page wrote it; **no page read it**, including the header itself. |
| the refresh token | Minted at login, kept 90 days, **never redeemed**. Every session died at 15 minutes. |
| `/reset` | The reset email linked to a page that did not exist. |
| `evening_teachings` | Read by the payroll, written by nothing. No evening class could have a teacher. |
| `packages/db/src/schema.ts` | Imported by nothing — a dependency carrying a high-severity advisory, with no purpose. |
| `audit_log` | 91 actions recorded, no reader. Deliberate (El Ourwa's is the same) — `docs/SECURITY.md`. |

⚠ **AND THE SECOND SEAM IS "GUARDED BY NOTHING."** RLS separates SCHOOLS, and it
was working perfectly while a signed-in parent could read their own school's
entire roster, every family's telephone number and every teacher's salary.
Different boundary, different mechanism, different place to look — ADR-0031.

Both questions are worth repeating against any new table, parameter or route.

⚠ **The UI is El Ourwa's, not a design of mine.** Its stylesheets are copied in
(`apps/web/public/elourwa/`), its sidebar, hubs, page titles and wording are
ported from `reference/v16/`, and the parent app carries its "Glass Ocean"
system — which is deliberately nothing like the direction screens' "Organic".

⚠ **We had been porting from El Ourwa v13. The real reference is v16**, in
`Eduplateforme/ourwa_deployement`, copied to `reference/v16/`. Always check the
version before trusting `reference/elourwa/`, which is v13.

⚠ **We had been porting from El Ourwa v13. The real reference is v16**, in
`Eduplateforme/ourwa_deployement`, copied to `reference/v16/`. The diff found an
entire missing subsystem — see ADR-0015. Always check the version before
trusting `reference/elourwa/`, which is v13.

⚠ **The API suite now connects as `app_user`, not as the database owner.**
`startTestPostgres` leaves `DATABASE_URL` pointing at the owner — right for a
migration harness, wrong for testing a product whose isolation is RLS, because
the owner is a superuser and superusers bypass every policy. `apps/api/test/
global-setup.ts` overrides it. Before that change, no API-level test was
actually subject to RLS; the first cross-school assertion written against the
new report service leaked another school's payroll and exposed it.

`scripts/e2e-run.sh` brings the whole stack up, seeds it and runs the browser
suite in one process tree. `pnpm dev` is the everyday command.

- Web: `nour|rissala|salam.localhost:3000` · console: `admin.localhost:3000`
- API: `localhost:3001` · Flutter parent app: `localhost:3002`

### Screens

Tableau de bord · Élèves · Classes · Notes (saisie + classement + bulletin
imprimable) · Appel · Finance (impayés, dette par famille, encaissement) ·
Cours du soir · Paie (salaires, prêts, caisses et retraits) · Rapports (mois,
jour par jour, moyens de paiement, année, effectifs) · Messages · Demandes ·
Inscrire un élève · Recherche · Mon compte · **Ma semaine** (professeur) ·
**Emploi du temps** · **Exclusions** · Console plateforme. Dépenses sit inside
Finance.

Parent app: enfants · bulletin · solde · messages · **absences** · **remarques**
· **exercices** (API; screens for the last three not built).

## Open issues

| # | Issue | Impact |
|---|---|---|
| 2 | **Docker deliberately skipped — not pending.** Owner's decision, 2026-08-30: ~1.6 GB to install plus ~1.5 GB per auto-update, on a metered connection, for nothing the system needs. Postgres is embedded (ADR-0004); Redis has zero references in the source, and the outbound queue is Postgres rather than BullMQ precisely so none is needed (ADR-0017). | `infra/docker-compose.dev.yml` stays unverified until someone is on an unmetered connection. **Do not re-propose it** without a reason that did not exist on that date. |
| 4a | **⚠ NEVER run `next build` while `next dev` is serving the same `apps/web/.next`.** The build overwrites the dev server's chunks; `main-app.js` then 404s and **React never boots**. Pages still render — server components, native form posts and server-action fallbacks all keep working — so the app looks fine while every client component is dead. Cost an hour of chasing a "broken" segmented control. Recovery: kill the dev server, `rm -rf apps/web/.next`, restart. | Silent and very convincing. Build into a separate dir or stop `next dev` first. |
| 4 | **Long-running dev processes do not survive between agent turns**, and a stale `next dev` will answer health checks while serving hours-old code. | `scripts/e2e-run.sh` frees the ports and clears the Postgres lock first. This cost several hours before it was understood. |
| 7 | **One Playwright test failed once and has not repeated.** `payroll.spec.ts › decides a request once` timed out on a full run, then passed in isolation and on an immediate second full run (45/45). Cause not established — it creates its own uniquely-named request, so it is not seed-state dependent. Separately, every full run leaves one `approval_requests` row behind (43 now) and the API caps that list at 100. | Watch it. If it recurs, start with the LIMIT 100 and with the dev server's first-hit compile. |
| 6 | **The browser suite is time-sensitive on a cold dev server.** Seen twice: `an absence is shown as an absence` timed out at 90 s inside an 8-minute run, and one `auth.setup` login failed on the first run immediately after a reseed. Both passed on an immediate re-run — 27/27 in 58 s. Next compiles each route on first hit, so the first pass measures the dev server. | Not a product fault, but it will read as a flaky suite. If it recurs, `next build && next start` before the suite instead of `next dev`. |


## What exists

```
apps/api      NestJS 10 + Fastify :3001 — auth (Argon2id + bcrypt upgrade,
              ES256, refresh rotation with reuse detection), tenancy, academic,
              finance, grades, parent, teacher, pedagogy, platform, evening,
              payroll, reports, comms.
apps/web      Next.js 15 :3000 — design system, dashboard, students, classes,
              notes (mark entry + ranking + printable report card), attendance,
              finance (outstanding + family debt + collection), evening classes,
              payroll, reports, messages, requests, platform console.
apps/mobile   Flutter parent app — login, children, report card, messages.
packages/db   22 migrations, seed, dev-server, test harness.
packages/shared  money.ts, grades.ts, bulletin.ts (both regimes).
tools/        reconcile/ and import/ — contracts only, not implemented.
```

## Session log

### 2026-09-06 — Session 18 (les deux migrations tranchées, et trois écrans amputés)

**Le propriétaire a tranché les deux points ouverts** (« YOU DECIDE ON THE TWO
ISSUES »). Migrations 0025 et 0026, ADR-0044.

⚠ **`NO ACTION`, surtout pas `RESTRICT`** — les deux refusent l'orphelin, mais
`RESTRICT` est vérifié immédiatement et casserait la suppression d'une école, qui
efface enseignements et notes d'un même geste. Une branche fermée serait devenue
insupprimable. Quatre tests en SQL direct tiennent les deux côtés.

⚠ **L'année d'une créance est un `smallint` sans clé étrangère** — une reprise
porte souvent sur une année dont nous n'avons aucune ligne, et une FK rendrait
ces saisies impossibles. Nullable et affichée « — » : on ne la déduit pas de
`created_at`, ce serait faux dans le cas qui compte.

**Trois écrans étaient amputés, et le balayage ne les aurait pas trouvés** — il
a fallu les regarder :

- **Revenue Live avait UNE section sur SIX.** C'est l'écran qu'on ouvre à la
  fermeture pour compter le tiroir ; sans la ventilation par moyen de paiement,
  le total ne se rapproche de rien. Les cinq manquantes étaient déjà servies par
  l'API. ⚠ Et son bilan annuel codait sa fenêtre en dur sur octobre-juin alors
  que l'année commence en **septembre** : un mois d'encaissements, celui de la
  rentrée, tombait hors du total sans que rien ne le signale.
- **`/finance/dettes` n'avait pas « Prêts en cours & soldés ».** On pouvait
  accorder des prêts pendant un an sans jamais en voir le total : `/payroll` ne
  montre que ceux d'une personne, et seulement à qui sait laquelle chercher.

**Balayage de défauts** — six OFFSET, huit `BYPASSRLS`, quarante-cinq routes
« sans garde » : **tous faux positifs**. Les premiers sont des commentaires
expliquant pourquoi on ne s'en sert pas (règles 17 et 3, propres) ; les routes
non décorées se gardent par leur classe ou relationnellement dans le service.

### 2026-09-06 — Session 17 (the JS that was never ported, and the dependency chain)

**⚠ `assets/js/app.js` HAD NEVER BEEN PORTED — and our stylesheet carried its
classes from day one.** `style.css` is a character-for-character copy of El
Ourwa's (`diff --strip-trailing-cr` returns one block, dead since `/forgot` was
removed). So `.input-error` and `.field-error` were defined, and **nothing ever
applied them**: every form fell back to the browser's native bubble — English on
an English machine, gone at the first click, silent about the second bad field.
Its rules are ported to the letter, mounted once in the shell.

⚠ And without the `invalid` listener none of it would ever show: native
constraint validation runs *before* `submit`, so the event never fires.

**The exclusions register had four inventions**, and six columns carried nine
facts. Gone. ⚠ **And I had read its query backwards**: `SELECT * FROM expulsions`
with no state filter — I concluded a lifted row stays listed, and removed our
toggle to "match". But **its table cannot hold a lifted row**: "Débloquer" is a
`DELETE` and there is no state column. Its page is the list of people currently
blocked. Its search was also moved to SQL — ours fetched 200 rows and filtered in
JavaScript, so past 200 blocks it quietly stopped finding.

**⚠ The mobile app fetched its notification badge once, at launch.** A family who
left the app open never saw anything arrive. `notifications.js` is ported to Dart
with its four rules — jitter, full stop when unwatched, backoff, five active
minutes after news. Its bottom nav already matched El Ourwa's exactly.

**⚠ Impayés was an N+1**: 100 families × 2 calls, each opening its own
transaction, each awaited in turn. 2 022 ms → ~1 200 ms, same 91 rows, arithmetic
untouched.

**⚠ And driving the counter screen by hand found a money defect.** A family's
own page said « ✓ En règle (0 MRU) » beside 6 500 MRU of fees marked « Non
payé », with the collect button disabled — while Impayés and Réinscriptions both
said 6 500. `forGuardian()` gated annual fees on *billable months*; El Ourwa
gates on a count of *enrolments*, and says so. ADR-0043. A new
`debt-agreement.spec.ts` now pins all three calculations against each other,
including the one place they legitimately differ.

**Dependencies: 2 critical + 14 high → 0 + 1.** Nest 11, Fastify 5, nodemailer
10, vitest 3, Next 15.5.25, a postcss override. Next 16 was tried and put back —
it generates its own `CLAUDE.md`. ⚠ The vitest 3 jump exposed a test that
inherited its grid from the previous test; a dependency on order is not
flakiness, it is a test that does not say what it thinks it says.

### 2026-09-05 — Session 16 (the sweep closed, and the seven defects it walked into)

**What was asked:** finish the page-by-page comparison, run both applications and
compare *by eye*, test end to end, and keep improving performance and security.

**The sweep itself is closed.** Every page with an El Ourwa equivalent now
matches or differs on record; `docs/parity/PAGE-BY-PAGE.md` is rewritten as a
finished-state document, with the four ways the audit lied to me kept in full at
the top because each cost a wrong conclusion.

**But the wording diff was not where the value was.** Two questions turned out to
be worth more than the diff, and both came from it:

> *« What does THEIR button actually do? »* — which found the deletes.
> *« Which screen calls this endpoint? »* — which found the missing screens.

The second is mechanical: list all 226 API routes, list every path literal in the
web and Flutter apps, subtract. Eight routes had no caller. **Three were real
gaps, one was a bug in my own tool, four are correctly unused.**

#### ⚠ Money could not leave the till

`paiement_staff.php` accepts `type ∈ {staff, profs, admins}`. We had two
categories. The third is the only place in El Ourwa where money goes from the
till to the direction — so `withdraw()`, the monthly ceilings, the report and the
permission all existed, tested, and **no screen offered the form**. A ceiling
nobody could reach because nobody could withdraw.

And the report that would have shown it **had never returned a single row**, in
any of its three periods: three parameters sent, one or two referenced, so
PostgreSQL refused to type the rest and rejected the whole query. The page's
`.catch()` printed « Aucun retrait sur cette période » on months where the cash
had gone out. Its « Moyens de paiement » column was a **hard-coded dash** — a
column that lies is worse than one that is missing, because it reads as « no
means recorded ».

#### ⚠ Deleting an assignment erased its grades

`grades.teaching_id` cascades. A secretary removing a mis-typed assignment in
October took a term of marks for the whole class with her, behind a confirmation
that mentions only the assignment.

**The reasoning was already written, two functions above.** `deleteSubject`
carries it verbatim — *« our FK cascades, so without it deleting a subject would
silently delete every teaching of it — and with them every mark »*. `deleteLevel`
and `deleteGroup` guard too. Only the door that leads most directly to the damage
did not. Its evening twin was worse: `evening_teacher_payments` cascades the same
way, so it erased **salaries already paid** — money out of the till with the books
saying it never left.

#### ⚠ The tariff that bills every school was guarded by nothing

`POST /platform/tariff` was the one console handler that never called
`assertPlatformAdmin`, on routes whose *only* gate is that call — the controller
says so in a comment. Any signed-in account, a parent included, could change what
every school is billed; and because the action is audited, it left a tidy trace.
`leaveBranch` likewise, which matters precisely because all it writes is an audit
row, with a school id supplied by the caller.

The tariff was also a JS `number` all the way through billing. At 750,55 the
tiles printed « 600 × 751 » beside a total of 450 330 — a multiplication nobody
can redo, which is exactly the argument the per-class table exists to prevent.

#### ⚠ An open parent directory

`GET /admissions/guardians` returned up to 200 families — names, emails, phones
— **with no search term**, and its comment was pleased about it. It duplicated
`/students/guardians/search`, which imposes a two-character floor and escapes
LIKE wildcards for a reason its own comment states: *« a parent, or a teacher,
could walk the alphabet and have all 1 372 »*. Nothing called the open one.
Removed.

#### Screens built

- **The withdrawal category**, with its three states and its red warning at El
  Ourwa's exact wording, the tender widget in `sortant` mode, and the report's
  two missing sections (`<tfoot>` TOTAL and « Répartition par administrateur »).
- **The two fiches of `recherche.php`.** Its « Action » column opens a profile;
  ours was a dead list. Nine fields for a pupil, the mark sheet, « ← Retour » and
  « ⚠ Expell »; six fields for a teacher and « Enseignements (par Niveau) ».
  `-1` prints « Absent », never « -1.00/20 », and nothing is averaged there.
- **The tariff form**, and **« Fermer toutes mes sessions »** — the only move a
  person can make alone when they think their account is open somewhere else.
  El Ourwa cannot have it; its sessions are PHP sessions.

#### Tested end to end, in the browser

Two withdrawals recorded through the form (one split across Bankily), both coming
back out in the report with their total and their per-holder breakdown; the
over-limit warning firing at the right threshold with the right colour; the
tariff moved to 750,55 and the arithmetic checked by hand (600 × 750,55 = 450 330)
then put back to 500; a Rissala pupil's id opened from a Nour session, returning
nothing.

#### ADRs

**0040** the fiche shows the enrolment's tariff, not the level's · **0041**
« Expell » blocks the identity and deletes nothing · **0042** neither delete
takes what hangs below it.

**Left for you** — two migrations, both recorded as open issues 8 and 9. Rule 16.

### 2026-09-04 — Session 15 (finishing the parity sweep, and what it turned up)

Three things were outstanding: `reinscriptions.php`'s six actions, the evening
timetable grid, and `gestion_caisse.php`'s exemptions — the last of which turned
out to be already done. Finishing the other two found four defects, and two of
them were serious.

**⚠ THE DEBT THAT BLOCKS RE-ENROLMENT WAS MISSING THREE OF ITS FOUR TERMS.**
`outstandingAcrossYears()` is what refuses a family at the counter and what the
exam ratchet reads. Its own doc comment quoted El Ourwa's rule — "mois échus non
réglés, reliquats de factures de TOUTES les années" — and then summed only the
months. Missing: **créances** (a family whose whole arrears sat in `misc_debts`
walked through owing nothing), **annual fees** ("une famille pouvait etre
reinscrite sans les payer"), and **`clears_all`** — so « Annuler toute la dette »,
which stores `amount = 0` with a flag, subtracted nothing and left the family
blocked while the screen said "la famille peut réinscrire". ADR-0035. The total
and the breakdown now come from one function, as El Ourwa's do, so the lines on
the screen add up to the figure above them by construction.

**⚠ EIGHT FOREIGN KEYS WERE UNENFORCEABLE AND NOTHING SAID SO.** `ON DELETE SET
NULL` on a composite key nulls *every* column of that key — `school_id`
included, and `school_id` is `NOT NULL` everywhere by construction. So:

```
DELETE FROM levels WHERE id = …
ERROR:  null value in column "school_id" of relation "groups"
        violates not-null constraint
```

« Supprimer le niveau » did not detach the classes; it failed, with a raw database
error, in exactly the case where one wants to delete a level. Reproduced on the
dev database before writing the fix. Migration `0022` rewrites all eight with
Postgres 15's `ON DELETE SET NULL (column)`. **The keys stay composite and the
isolation guarantee is unchanged.** ADR-0036. Found by a test on the evening
grid, which is the only reason it was found at all.

**`reinscriptions.php` — all six actions and the screen.** `autoriser` becomes a
stored decision rather than a call flag, with the amount owed frozen at the
moment (ADR-0037); `dette_modifier` and `dette_annuler` move a `corrected_balance`
and never `total`, because what was claimed has to stay legible; `dette_creer` and
`remise` were already there and are now on this screen too. The page groups
candidates by family with the debt stated once — its own recorded bug was "une
famille de quatre enfants affichait quatre fois 8 000 MRU" — sorts blocked
families first, and greys a blocked pupil's checkbox as its `disabled` does. Not
in the menu, because it is not in El Ourwa's menu either. The accountant is not on
it, because `require_role` excludes them (ADR-0038).

Verified in the browser against the seeded 200 families: the breakdown sums to
the total in every case, the cursor walks 6 pages / 200 families with no
duplicate and no gap — including two distinct households both called "Abdallahi
Mint Ely" — and a créance was created at 4 500, corrected to 1 200, then
cancelled, with `total` reading 4 500 throughout and the row kept.

**The evening timetable grid.** `placer_creneau` and `effacer_creneau`, on a new
`evening_timetable_slots` (migration `0021`). A slot sits on a **subject**, and
the subject must be one of the group's own — "une matière naît de l'assignation
d'un professeur" — while the teacher is optional. Ordinals rather than French
strings, one copy of the teacher rather than two (ADR-0039). Placed a slot in the
browser, watched the sole teacher of a subject preselect itself as its script
does, and cleared it again.

**Two smaller things, both user-visible.** `c.outcome === 'failed'` never matched
anything: the value is `held_back`, so an **ajourné pupil displayed as "En
cours"** on the re-enrolment screen — precisely the pupil who must not be moved
up a level. And `refuseProgression()` refused in English, on a screen the
accountant reads; it now says what El Ourwa says.

**And `pnpm -r typecheck` was failing, on a package nobody had typechecked
since it was written.** `session-expiry.ts` reached for `Buffer` — which exists
in one of `@elourwa/shared`'s three runtimes (Node yes, Edge only by Next's
polyfill, browser no). Now `atob` + `TextDecoder`, which all three have.
Checked before changing it that this was a typecheck fault and not a live one:
the middleware had been renewing twice in twenty minutes of browsing, not on
every request — which is what a silently-failing `accessTokenExpiry` would have
caused, and with rotation plus reuse detection that would have logged people out
of everything.

**A documentation defect too.** ADR-0027–0030 existed twice, written by two
parallel passes, and the duplication had already produced one wrong citation in
the glossary. The second block is now 0031–0034 and every reference repointed.

Fixed while building: a nested `<form>` inside the bulk selection form broke
React hydration for the whole page — which is the same mistake `reinscriptions.php`
warns about in a comment ("imbriquer deux <form> est invalide en HTML"). Collapsed
to one hidden form with an `op` field, exactly its `#form-dette`, which also fixed
a stale banner: three separate action states meant an older success masked a newer
one, so an annulment still said "Dette mise à jour".

### 2026-09-04 — Session 14 (the two named actions, then a security audit)

**`appliquer_reduction_cs` and `annuler_paiement_prof_cs`**, both asked for by
name. Neither had a home in the schema; migration 0019 gives one to each —
`evening_discounts` as its own table (ADR-0034), and a reversing entry rather
than El Ourwa's DELETE (ADR-0033). Verified end to end in the browser:
3 000 − 1 200.50 offered to the till as 1 799.50, and a cancelled salary leaving
`4910.00 reversed=true` beside `-4910.00`, with `out` beside `in` in the ledger.

**Then the audit, and it found the worst defect of the project so far.**

⚠ A SIGNED-IN PARENT COULD READ THE WHOLE SCHOOL. `/students`,
`/students/guardians/search`, `/students/count`, `/enrollments/:id/months`,
`/teachers` and every reference read carried no permission decorator, and the
`parent` role holds **none** — so "no decorator" meant "anybody with a token".
Two characters of a search returned twenty families with their telephone
numbers; `/teachers` returned every salary. Proved with a real parent token
before the fix and after it.

RLS was working the whole time. It answers *which school*; nothing was answering
*which role*. See ADR-0031.

Also closed: `change-password` was an unmetered password oracle (300 guesses a
minute against the account you are already in); `forgot-password` could put 300
messages a minute into a family's inbox; and the API sent **no security headers
at all** — most importantly no `Cache-Control: no-store` on responses carrying
one family's debt.

The dependency audit (38 advisories) is triaged by REACHABILITY in
`docs/SECURITY.md`, with each deferral reasoned and dated rather than ignored.

**Two guards added that catch their own class of bug:** `permission-names.spec.ts`
— a permission nobody holds closes a door silently, and it immediately caught
`derogations.gerer`, which every `pnpm seed` had been deleting — and
`parent-cannot-read-school.spec.ts`.

**And a 500 on the parent app's home screen**, found by signing in as a parent:
`/parent/children` counted absences with `a.academic_year_id`, a column
`attendance` does not have. Nothing caught it because nothing called the
controller — the suites exercise services, and that query is inline.


### 2026-09-02 — Session 13 (parity sweep, and four things nothing read)

Ran El Ourwa v16 page by page against ours. The wording differences were the
smaller half; what the comparison actually surfaced was a class of defect that
looks like nothing on a screenshot.

**`notifications` was write-only.** Rows have gone in since homework shipped and
nothing in the system ever read one back — no endpoint, no screen, no badge. A
school sent an exercise to thirty families and none of them were told. Now a
bell in the parent app with its own count and a stream behind it, in both
languages, with the exam ratchet applied: a family in debt does not receive
`grade` notifications, because withholding results is how the school gets paid
and an announcement carrying "14/20" defeats that as completely as the bulletin.
The count uses the same filter as the list, as El Ourwa's does.

**The year selector did nothing.** It is rendered by `PageHeader` so it is on
every screen; it writes `?annee_id=` and not one page read it, including the
header, which always drew the *active* year as selected. Pick 2024-2025, watch
the page reload identical. Fixed by carrying the parameter in a request header
from middleware — `searchParams` reaches a page but never a layout, which is
why the header could not reflect the choice even in principle — and twelve pages
now honour it through `anneeAffichee()`.

**The session died every fifteen minutes.** `/auth/refresh` had no caller
anywhere in the web app. Renewal now happens in middleware, which is the only
place in the App Router that can both call the API and set a cookie. Prefetches
are skipped deliberately: rotation revokes the family on reuse, so renewing on a
speculative prefetch would sign the user out of everything.

**The password reset flow was a dead end at every step**: the email linked to a
`/reset` page that did not exist, nothing linked to `/forgot`, and `/forgot`
called the API from the browser where our own CSP blocks it.

**Two in the Flutter app**, both about staying signed in: `refresh()` deleted the
ninety-day credential on ANY non-200 (a 502 cost a parent their session), and
concurrent 401s each rotated the same token, which the server punishes by
revoking the family. `ApiClient` now takes an `http.Client` — the retry path had
no test and could not have one.

**Ported this session**: the whole of `gerer_niveaux.php` (a drill-down, not a
list — seven actions that did not exist), `inscrire_etudiant.php`'s defaults and
its "Mot de passe initial", the caisse profile's missing header, year selector,
remise journal and full annual-fees block, the annual-fee receipt, and
`emploi_du_temps.php`'s "✓ Valider et publier".

**Corrected in our own notes**: the moughataas are `lieu_naissance` values, not
addresses — see ADR-0019. `etudiants` has no address column at all.

### The same session, second half — actions rather than pages

Extracted all **109 POST actions** across El Ourwa's 25 acting pages and checked
each against our own. That found a second family of defect: an endpoint with no
caller, which looks finished from either side alone.

  mettre_a_jour_tarif      a teacher's pay could not be changed from ANYWHERE
  changer_identifiant      on four of its pages, on none of ours — a parent
                           whose telephone changed was locked out for good
  changer_nom              nobody could correct their own name
  modifier_heures          an assignment could be created, deleted, never fixed
  assigner_prof (soir)     `evening_teachings` was read and never written, so
                           the whole "Paiement des Professeurs" tab was built on
                           a table no screen could fill
  modifier_groupe (soir)   a rate typed wrong billed every enrolee all year
  retablir_exemption_auto  its inverse existed; this did not

**Two guards were added because I made the mistakes they catch.** A backtick in
a SQL template literal took the API down at 14:03; `sql-literals.spec.ts` caught
the next one before it was committed. `coursdusoir.gerer` was a permission I
invented; `permission-names.spec.ts` caught it AND found that `derogations.gerer`
had been deleted by every `pnpm seed` since migration 0010.

⚠ **Around a hundred user-facing messages were in English** — starting with the
login page's "Invalid credentials". See ADR-0030.

⚠ **ADR-0029 names two evening actions that stop here**, both needing a
migration to a money table. Standing rule 16: ask first.


### 2026-08-31 — Session 12 (the last two issues, and how to run it)

**`user_school_roles` — enforced rather than remembered.** The open issue said it
carries `school_id` with no RLS and the filter is by hand. Adding a policy was
the obvious fix and is the wrong one: `schoolsForUser()` deliberately reads
across schools, because a parent may have children at two branches and a platform
administrator belongs to none. A policy makes that lookup impossible — which is
what ADR-0006 already decided.

So the mechanism is a test instead. `tenant-filter.spec.ts` reads the source and
fails on any query touching that table without `school_id`, with the one
deliberate cross-school lookup named explicitly so a second exemption has to be
written down rather than slipped in. It carries a control case, and a third test
that fails if `schoolsForUser` is ever rewritten — otherwise the exemption would
quietly start matching nothing and let new unscoped queries through.

**The unbranded login page after logout.** Fixed by distinguishing two things
that were collapsed into `null`: "this host names no branch" (the platform
console) and "this host names a branch but the lookup failed". Only the first
should print "Console plateforme"; printing it on a school's own domain tells the
user they are somewhere they are not. A failed lookup now falls back to the slug —
wrong capitalisation, no Arabic name, still the right school.

**`docs/RUNNING.md`** — how to see it locally and how to host it. Every account,
URL and branch in it was executed rather than written from memory. The hosting
section leads with latency rather than price, because every page is
server-rendered and a school in Nouakchott feels 120 ms on every click.

### 2026-08-31 — Session 11 (the three go-live blockers, closed)

**⚠ THE PASSWORD RESET LINK WAS BEING PRINTED TO THE SERVER LOG.**

When SMTP was unreachable, `password-reset.service.ts` logged the link. In
development that is convenient. In production it is a live credential in a file
that gets shipped to log aggregation and read by people who should not be able to
take over an account. It also sent INSIDE the request, so a slow mail host hung
"forgot my password", and a restart mid-send lost the message with no trace it
had existed.

**Issues 7 and 8 were one problem**: there was nowhere to hand work that must
leave the process and must not be lost. `outbound_mail` is that place — a durable
queue drained with `FOR UPDATE SKIP LOCKED`.

It is **not BullMQ**, which standing rule 18 names. BullMQ needs Redis, Redis
needs Docker, and Docker was deferred for good reason. A Postgres queue needs
nothing new, and is more durable than an unpersisted Redis: a crash leaves the
row where it was. ADR-0017 records the departure and the seam to move it later.

Failure is now visible rather than silent: with no `SMTP_HOST` the worker says so
once at boot, messages accumulate as `pending`, and `queueHealth()` reports the
backlog. The failure being replaced is a school discovering in March that no
parent has had a reset since October.

Bulk messaging is **two statements regardless of school size** — one INSERT for
the messages, one INSERT…SELECT for the queue, driven by the first's `RETURNING`.
A draft matched recipients on a five-second `sent_at` window, which would
double-queue two sends of one subject in a minute and miss rows whenever the
transaction ran long.

**Issue 9 — the backup.** `scripts/backup.sh` archives the dump and the upload
directory together and writes a manifest comparing attachment ROWS to attachment
FILES. `AttachmentsService.integrity()` answers the same question live, and a
test deletes a file to prove the check reports `complete: false` rather than
staying quiet until a parent taps a broken link.

**Two stale issues closed while here:** the note claiming the mailer prints links
to the console (no longer true, and the reason it mattered), and the one saying
teacher pay is flat-salary-only (hourly pay landed in session 8).

### 2026-08-31 — Session 10 (attachments, and two bugs nothing had noticed)

**⚠ SENDING AN EXERCISE HAD NEVER WORKED.**

`sendHomework` writes the exercise and then one notification per family, and that
second INSERT put an uncast `$1` in a SELECT list. Postgres has no column to infer
a parameter's type from there, settles on text, and refuses to put text into a
uuid column — so every call failed with
`column "school_id" is of type uuid but expression is of type text`.

It survived because `pedagogy.spec.ts` did not exist. It does now, and its first
test is the regression. While writing it the notification also gained its
`academic_year_id`, which v15 added so a closed year's notifications stop being
visible to families.

**⚠ EVERY VALIDATION MESSAGE IN THE API WAS INVISIBLE.**

There was no exception filter for `ZodError`, so every `.parse()` failure became
`500 Internal server error`. Two consequences, both bad: the carefully worded
messages in this codebase — "Amount must be a decimal string", "Record how the
money arrived" — never reached anyone, because the web client reads
`body.message`; and a 500 says *the server is broken*, so a clerk who mistyped an
amount would have reported an outage.

A global filter now returns 400 with the reason and the field it concerns. This
improved every route in the API at once.

**Attachments** (ADR-0016). El Ourwa v16's validation is ported literally —
size ceiling, real MIME from the bytes, magic bytes, extension agreeing with
content, random stored name. Its *serving* is not: El Ourwa hands the file to
anyone holding the URL because Apache serves it unauthenticated, which its own
comment attributes to XAMPP rather than to choice. Ours are outside any served
directory and handed out by a route that checks the caller — a test asserts a
signed-in parent from another family is refused.

Tests show each layer refusing what the others would let past: a PHP script named
`.png`, a real PNG named `.pdf`, and a `.wav` named `.webp` — RIFF like a WebP,
but without `WEBP` at offset 8.

**One thing this introduces**: files are on disk, so a database backup is no
longer a complete backup. Recorded as open issue 9, to settle before any real
file is uploaded.

**Also confirmed dead:** `caisse_jours` is in El Ourwa's schema with zero
references anywhere in v16. FEATURES #90 is a dead table, not a feature.

### 2026-08-31 — Session 9 (teacher self-service, and a scoping hole)

**⚠ A TEACHER COULD WRITE A REMARK ABOUT ANY CHILD IN THE SCHOOL.**

`POST /remarks/student/:studentId` was behind `notes.consulter`, which every
teacher holds, and checked nothing else. A teacher could leave a remark on a
child they had never taught, and the family would read it. v16 scopes the same
screen with `WHERE et.id = :e AND e.professeur_id = :p`; we did not.

`grades.teachesStudent()` now joins the child's enrolment to the teacher's own
teachings, and the route refuses anything else unless the caller holds
`scolarite.groupes` — administrative reach covers the whole school, as it does in
El Ourwa. Three tests: a child in their class, a child taught by somebody else,
and a user who teaches nothing.

**Teacher self-service.** "Ma semaine" now sends exercises and writes remarks,
both scoped to the teacher's own classes. The roster comes from
`/teacher/my-students`, resolved from the token — a list built from an id in the
URL would be a list the caller chose. The select is a convenience; the API
re-checks, because a select is only as trustworthy as the browser it renders in.

**Grade entry stays out.** `professeur/saisir_notes.php` has NO writes in v16
either — it is a dead stub there too. ADR-0005 holds: teachers do not enter
grades. Checked rather than assumed.

**The parent app would have CRASHED on a withheld report card.** The Dart model
read `json['regime'] as String` and `json['term'] as int`; the withheld response
omitted both. The API now returns a complete shape with `withheld: true`, and the
client tolerates a partial payload anyway — a screen that throws tells a family
nothing, and they conclude the school has lost their child's marks.

The withheld state is its own screen, never the empty one. "No marks yet" and
"we are holding your child's results because you owe us money" are entirely
different messages to a parent; showing the first when the second is true sends
the family to the school asking why the teacher has not marked the papers. It
says why, what to do, and that a term already settled stays open — so the lock
does not read as arbitrary.

### 2026-08-31 — Session 8 (the v16 audit)

**⚠ WE HAD BEEN READING THE WRONG SOURCE.** `reference/elourwa/` is v13. The live
system is **v16**. Diffing them found one page never seen (`derogations.php`) and
two migrations never read — an entire subsystem, not a detail:

**Exam results are withheld from families in debt, term by term, and the lock is
a RATCHET.** Settle, and the current term opens permanently; fall behind again
and the next term shuts while the earned one stays open. Recorded rather than
recomputed, because the debt balance is updated in place with no history — "this
family was up to date during term 1" has to be written down while it is true.
Fails closed throughout. Full reasoning in ADR-0015; 21 tests walk the exact
sequence the legacy file documents, because the sequence IS the rule.

Two deliberate departures. The WHOLE report card is withheld, not just its exam
column — the average is computed from the exam mark, so blanking the column still
publishes the number and the mark is recoverable by arithmetic. And coursework is
never withheld: the block is a lever over results, not a way to hide a child's
daily work from their parents.

`derogations.gerer` is direction-only, which takes the catalogue to **25
permissions**. `CLAUDE.md` still says 24 and is one behind.

**Write-offs became writable.** `debt_write_offs` had a read path and no way to
create a row, so a `remise` could not actually be granted. v16 fires the exam
ratchet after one, for the stated reason that a write-off can settle a family
outright.

**Also built:** bulk re-enrolment (each student attempted separately, every
refusal reported BY NAME — a count of "3 blocked" tells the office nothing they
can act on), the four reference-data screens, exercises and remarks, the live
till, and every report card in a class as one printable document.

**One shared computation, not two.** The class print run needed per-subject rows,
which `classReportCards` did not return. Rather than fetch thirty cards one at a
time — thirty rounds of the same query, each ranking a child against a roster it
had loaded separately — the presentation helper was hoisted to module scope and
the class pass now returns the same rows the single card does.

**A guard for a mistake made three times.** A backtick inside a SQL template
literal ends the literal; a comment written in the habit of prose broke the build
three separate times, surfacing as "Expected )" pointing at innocent SQL dozens
of lines away. `test/sql-literals.spec.ts` now finds it at the character, and has
a control case proving it catches the thing it exists for.

**One aggregate bug caught by looking at the output.** `earned_terms` came back
as `[null]` for every family: a LEFT JOIN manufactures a row of NULLs, and that
row satisfies `revoked_at IS NULL`, so the FILTER let it through.


### 2026-08-31 — Session 7 (partial salaries, accounts, and a destroyed database)

**⚠ THE TEST SUITE WIPED THE DEVELOPMENT DATABASE. That is fixed.**

`startTestPostgres` adopted any reachable `DATABASE_ADMIN_URL` and reset it —
`DROP SCHEMA public CASCADE`. Exporting that variable to run a migration and then
running the suite in the same shell was enough: 600 seeded students were replaced
by test fixtures, and the only symptom was a login that stopped working. Sixteen
fixture schools (`pay`, `fin`, `tt`, `plat-a`, …) were sitting in the dev
database before anyone noticed.

An external database must now SAY it is disposable — named `*_test`, or
`ELOURWA_TEST_DB_RESET=i-know-this-wipes-it`, a value hard to set by accident.
Anything else is left alone and the suite starts its own throwaway Postgres.
`packages/db/test/testing-guard.test.ts` is the control experiment: it asserts
the real dev URL is refused, that `1`/`true`/`yes` do NOT satisfy the opt-in, and
that `testing` and `contest` are not mistaken for `test`. A guard nobody has
watched refuse anything is not a guard.

**Partial salary payments — open issue 7a, now closed on the owner's decision.**

El Ourwa permits them and we forbade them. Migration `0009` drops
`salary_payments_once_idx`; the rule is now "a month's payments may not sum to
more than the month's entitlement", which no unique index can express. It lives
in the service behind `pg_advisory_xact_lock` — without that, two clerks pressing
"pay" at the same instant both read the same balance and both pay it, which is
the exact double payment the index existed to prevent.

Three bugs the tests caught on the way:

- **A reversal is itself `reversed = false`.** Filtering the running total on
  that column alone counted the −90 000 and dropped the +90 000 it cancels, so a
  reversed month reported as owing 175 000 instead of 85 000. Both halves are
  excluded now.
- **A loan that swallows the whole salary.** Refusing when nothing is payable
  also refused the withholding, and the withholding is how the loan gets repaid.
  Nothing-to-pay AND nothing-to-withhold is settled; nothing-to-pay but something
  to withhold is a month eaten by an instalment, and it must still be recorded.
- **A loan withheld once per month, not per instalment.** Paying in two parts was
  taking the deduction twice, repaying the loan twice over out of one month's
  entitlement.

**Accounts — the whole `comptes_*` cluster.**

`creer_utilisateur`, `ajouter_staff`, `comptes_staffs`, `comptes_profs`,
`comptes_parents`, `reinitialiser_mdp`, `gerer_professeurs` and `historique`.
A login and the personnel record that goes with it are created in ONE
transaction: an account with no record cannot be paid, a record with no account
cannot sign in. The new accountant appears on the payroll immediately, which a
test asserts.

El Ourwa's role rules kept with their reasons: a teacher holds ONE role because
their account carries a teaching record rather than a stack of administrative
functions, and `admin` cannot be stacked because it already contains the others.
Whichever of salary / hourly rate does not apply is zeroed, so an interim teacher
cannot carry a stale flat salary that would be paid the moment someone flipped
them to permanent.

The temporary password is generated, shown once and never stored in clear. It
was 8 characters when it claimed to be 10 — `randomBytes(6)` in base64url is 8,
and slicing cannot extend it. Fixed the generator, not the assertion.

**Two tenant-isolation checks worth naming.** `users` is a PLATFORM table, so
resetting a password verifies the account actually belongs to this school first —
without it a branch administrator could reset anyone on the platform, and a test
proves the refusal. `login_attempts` has no `school_id` at all (rate limiting
runs before a tenant is known), so the journal is scoped by joining through
`staff`/`teachers`/`students`, whose policies do the work.

**One brittle test corrected.** The payroll metric asserted the seed's own
"/ 20". Creating one staff account through the UI broke it without breaking
anything real. It now asserts the metric agrees with the list beneath it.

**One suite-ordering bug.** `roles` is global — no `school_id` — so it is one
catalogue shared by every spec. Two files seeding it with a plain INSERT meant
whichever ran second died on the unique code, and which one that was depended on
the runner's scheduling. Both are idempotent now.


### 2026-08-30 — Session 6 (timetable, expulsions, teacher hourly pay)

**Built**

- **Teacher hourly pay**, ported from `paiement_staff.php` with its oddities
  intact (ADR-0014). An interim teacher earns Σ (hours/week × **4** × the
  ASSIGNMENT's rate, falling back to the teacher's). Migration `0008` adds
  `teachings.hourly_rate`, nullable — NULL means "the teacher's rate" and is not
  zero, which a test asserts by arithmetic that would come out differently if it
  were. `paySalary` and the payroll list now share the rule, so the list and the
  payslip cannot disagree.
- **The weekly timetable** — six days × three slots, one lesson per cell.
  The unique index stops a CLASS being double-booked; the service stops a
  TEACHER being, because that constraint spans rows an index cannot see and is
  otherwise discovered by a teacher standing in a corridor.
- **The expulsion register.** Blocking is by IDENTITY (NNI + RIM), never by
  student id, so it survives deletion of the child's file. `admit()` checks it
  **before** writing anything — verified end to end: the refused attempt left no
  student and no orphan guardian account. Lifting is recorded, never deleted.
- **"Ma semaine"** — a teacher's own classes and own week, both resolved from
  the token. There is deliberately no teacher id in the URL to tamper with.

**Two decisions recorded (ADR-0014)**

The ×4 is a fixed multiplier, not the weeks in a month, and it stays: correcting
it would quietly give every interim teacher a raise in the long months, which is
the school's decision, not a port's (rule 19). And our expulsion register is
school-scoped where El Ourwa's is global — El Ourwa is one school and cannot
express the difference; blacklisting a family across branches a school does not
control is not a side effect a local disciplinary matter should have.

**One divergence found and deliberately NOT fixed**

Reading the legacy pay code for the hourly rule surfaced something unrelated to
it: **El Ourwa permits partial salary payments and we forbid them.** It sums what
has already been paid for the month and allows any further payment up to the
balance. Our partial unique index allows exactly one. Standing rule 26 says El
Ourwa is right until proven otherwise, and half now / half at month end is an
ordinary way for a school with uneven cash flow to pay people. It touches money
and a migration, so rule 16 applies: recorded as open issue 7a and an OPEN
QUESTION in `DECISIONS.md`, and left alone. **Ask the school before cutover.**

**One test corrected rather than the product**

A browser test asserted that an accountant sees no expulsion register. They do,
and should: `comptable` holds `scolarite.inscrire`, so they admit children, and
the people who admit are exactly the people who need to know who may not be. The
assertion was a guess about the permission design; it now states the design.


### 2026-08-30 — Session 5 (admissions, expenses, search, compression)

**Docker: decided against, not deferred.** ~1.6 GB to install plus ~1.5 GB per
auto-update on a metered connection, for nothing the system needs — Postgres is
embedded, Redis has zero references in the source, and the password-reset mailer
already falls back to printing the link to the console. Recorded as open issue 2
so it is not re-proposed. Two genuine gaps it does NOT excuse are now issues 7
and 8: production has no mail path, and bulk messaging runs inline.

**Built — the holes that made the product incoherent**

- **Admissions.** Until now only the seed could bring a student into being: the
  product could list, grade and bill children it had no way to create. A child
  and its family are created together or not at all; RIM and NNI collide only
  within a school; a sibling attaches to the existing family rather than making
  a second account, and therefore a second debt. The temporary password is
  generated, shown once, and the account is flagged to force a change.
- **Expenses.** `Rapports` had been reporting a `Dépenses` line since it was
  written, and nothing in the product could produce one. Append-only, like every
  other financial record.
- **Global search.** `recherche.globale` had been granted to two roles since the
  permission catalogue was seeded and did nothing at all.
- **Parent absences, remarks and homework**, and **changing your own password**
  (current password required even when signed in — an unattended session at the
  cash desk must not lock the owner out of their own account).
- **Response compression.** `/parent/balance` fell from 1689 B to 376 B, a 78%
  saving on exactly the connection that is metered. Threshold 1 KB, so the
  smallest payloads are left alone where the gzip header would cost more than
  it saves.

**Four defects found**

1. **A guardian could be created who could not sign in.** `INSERT … SELECT` over
   a missing `parent` role inserts nothing and reports success. The office would
   have been handed credentials for a dead account. Now refused outright.
2. **`apps/api` declared Fastify 5 while running Fastify 4.** A pre-existing
   mismatch, invisible until a plugin needed to type against the instance —
   meaning the `FastifyRequest` types used across the auth layer had been
   describing a different Fastify from the one actually serving requests. Pinned
   to what runs.
3. **The segmented control's radios shared no `name`.** Not a radio group at
   all: nothing unchecked its sibling, and a screen reader announced BOTH
   options as selected. Found in a Playwright snapshot, present in four forms.
4. **⚠ `next build` un-hydrated the entire running app.** Running it to measure
   bundle sizes overwrote the `.next` directory a live `next dev` was serving;
   `main-app.js` began 404ing and React never booted again. Every page still
   RENDERED — server components, native form posts and server-action fallbacks
   all kept working, so admissions and expenses submitted correctly — while
   every client component sat dead. An hour went into chasing a "broken"
   segmented control that was fine. Now open issue 4a.

That last one is worth keeping for a second reason: the app degraded to
server-rendered forms and stayed usable. That is the progressive enhancement
ADR-0011 was aiming at, accidentally proven.


### 2026-08-30 — Session 4 (payroll, reports, messaging, requests)

**Built**

- **Payroll**: migration `0007` (`staff`, `salary_payments`, `staff_loans`,
  `loan_instalments`, `loan_repayments`, `fund_holders`, `withdrawals`,
  `messages`, `approval_requests`), all RLS-enabled and forced. Salaries,
  loans recovered by salary deduction, cash repayments, fund holders with
  monthly withdrawal ceilings.
- **Reports**: the month in and out, collections day by day, the incoming
  tender split, the year so far, headcount by sex per level, and today's till.
- **Messaging**: direction → families, one family or every enrolled family,
  with a read stamp the parent app sets and the office reports on.
- **Demandes**: the accountant raises, the direction decides — once.
- **Parent app**: an inbox with an unread badge, and `post()` on the API client.

**Four real defects, three of them found by writing the test first**

1. **⚠ The API test suite was not subject to RLS at all.** `startTestPostgres`
   sets `DATABASE_URL` to the owner connection, and the owner here is a
   superuser — superusers bypass every policy, forced or not. The first
   cross-school assertion in `payroll.spec.ts` read another school's payroll
   and passed nothing. `global-setup.ts` now points the suite at `app_user`.
   Every existing API test still passes, so nothing was relying on the leak,
   but for four sessions the suite had been proving less than it claimed.
2. **A month filter hung off a LEFT JOIN removed nothing.** In
   `byPaymentMethod`, `LEFT JOIN payments p ON … AND p.calendar_month = $1`
   left every `payment_lines` row in the sum. Asked for a month in which
   1 000 moved, it answered **231 000** — the whole year, under one month's
   heading, looking entirely plausible. Reverting the fix and watching the new
   test fail is what proved the test bites.
3. **A shortfall was silently forgiven.** `creditInstalments` set
   `withheld = true` on a partially covered instalment, and `loanDeductionFor`
   skipped withheld rows — so a month whose salary could not cover its
   instalment cancelled the remainder. Deductions now roll arrears forward:
   everything due on or before the month and not yet fully repaid.
4. **A reversed salary could never be re-paid.** The partial unique index
   excluded reversals but not the entry a reversal had annulled, so the month
   stayed occupied by a cancelled payment. `salary_payments.reversed` marks the
   annulment — the amounts are never touched — and the index excludes it.

**One divergence from El Ourwa, recorded rather than absorbed**

`rapport_financier.php` builds the whole monthly report from `paiement_lignes`
filtered on `MONTH(date_creation)` — **when the money moved**, not the period it
settles. Our first version keyed tuition and salaries on the billed month and
expenses on the spend date, which is the one combination that is definitely
wrong. Now every figure is dated by the movement. **ADR-0013.**

The same ADR records what is still missing: El Ourwa routes every outflow
through the tender ledger and we route none, so nothing here knows *how* a
salary left the till. That is a money-and-migration change; standing rule 16
says ask first, so it has not been made.

**Design**

The tab strip was pushing `Déconnexion` off screen for a super administrator
holding ten sections. The links now scroll in their own container with the
identity and the way out pinned outside it, and the active tab scrolls itself
into view. Money no longer wraps mid-number in a table cell. An empty month
names a month that has data instead of rendering four zeros and a blank chart;
a failed report renders as a failure rather than as an empty page.


### 2026-08-25 — Session 3 (ecosystem)

**Done**

- **Phase 1 completed and proven live**: Argon2id with bcrypt fallback and
  transparent upgrade, ES256 access tokens, opaque refresh tokens hashed at rest
  with rotation and reuse detection, rate limiting keyed on account and IP,
  permission guard driven by `role_permissions` data, audit log on every mutation.
- **Phase 2**: academic years with closed-year read-only enforcement, levels,
  groups, subjects, teachers, teachings, enrolment with the rule of the 25th, the
  progression rule, year closure.
- **Phase 3/5 calculation**: both bulletin regimes as pure tested functions —
  weighted mean out of 20 for collège/lycée, a TOTAL out of the sum of scales for
  fondamental — with the absent marker excluded before averaging.
- **Phase 4**: three-level fee resolution, per-branch receipt sequences taken
  atomically, tender split that must reconcile to the cent, append-only payments
  with reversing entries, the debt rule, exemptions, discounts, write-offs.
- **Phase 6 (partial)**: the direction web app, working against the live API.
- **Phase 5 (partial)**: parent API and the Flutter app's login, dashboard and
  report card screens.

**Three real bugs, each found by a test or by looking**

1. **Pool-exhaustion deadlock.** `AuditService` acquired a second connection
   while the caller held one inside its transaction. With a pool of 20, twenty
   concurrent payments each waited for a connection that would never free. The
   20-way concurrent receipt test hung rather than failed. Audit writes now join
   the caller's transaction.
2. **A swallowed error that hid a doomed transaction.** Having made audit share
   the transaction, its `catch` became actively harmful: a failed audit insert
   has already aborted the transaction in Postgres, so swallowing it returned
   "success" for work that silently vanished. It now propagates when given a
   transaction, and only swallows on its own connection.
3. **`slugFromHost('127.0.0.1:3000')` resolved to a school called `127`.** An IP
   address was being treated as a subdomain. Fixed in the API and the web, which
   share the rule.

Also: `pnpm dev` died entirely if Postgres was already running, because turbo
treats one failed task as a failed run. The dev server now attaches to a live
instance.

**Two duplications resolved rather than left**

Both the web and mobile apps had two parallel session implementations from
earlier partial passes. In each case the *older* code was better in one specific
way, and that way was kept:

- Web: the discarded route revoked the refresh token server-side on logout.
  Folded into the server action — clearing a cookie alone leaves a valid 90-day
  token alive.
- Mobile: `AuthStore` hardened the secure-storage options and deliberately did
  **not** persist the 15-minute access token. `ApiClient` now uses it.

**Scope reversed, twice, on instruction**

ADR-0001 (no migration) → ADR-0010 restores that position after `PROJECT.md`
briefly made the import authoritative. `origin` and `legacy_id` stay in the
schema: four bytes, already written, and removing them would only have to be
undone. `tools/reconcile` and `tools/import` keep their contracts and remain
unimplemented.

**Left unfinished**

Open issues 1–7. Nothing is blocked on code; the three tool installs would let
the remaining Phase 0 exit criteria be confirmed.
