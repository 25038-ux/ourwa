# Les notifications instantanées — le projet Firebase, en six étapes

Sans Firebase, l'application des familles **interroge** le serveur : dans les
15 secondes quand elle est ouverte, dans les 15 minutes quand elle est fermée.
Avec Firebase (Cloud Messaging, gratuit, sans carte bancaire), une note, une
absence, un message ou un emploi du temps **arrive en quelques secondes,
application fermée**, avec la sonnerie et la vibration.

Le code est prêt des deux côtés ; il ne manque que les valeurs du projet.
Tout se passe sur <https://console.firebase.google.com> avec le compte Google
de l'école (à créer sur <https://accounts.google.com> s'il n'existe pas —
un compte Gmail ordinaire suffit).

## 1. Créer le projet

*Ajouter un projet* → nom **El Mourad** (ou celui de l'école) → Google
Analytics : **désactiver** (inutile ici) → *Créer*.

## 2. Déclarer l'application Android

Sur la page d'accueil du projet, l'icône **Android** (« Ajouter une
application ») :

| Champ | Valeur |
|---|---|
| Nom du package Android | **`mr.elmourad.parent`** (El Ourwa : `mr.elourwa.parent`) |
| Pseudo | El Mourad |
| Certificat SHA-1 | laisser vide |

*Enregistrer l'application*. Le fichier `google-services.json` proposé
ensuite **n'est pas nécessaire** (l'application s'initialise par code) ;
passer les étapes suivantes avec *Suivant* jusqu'à *Continuer vers la console*.

## 3. Relever les quatre valeurs de l'application

Roue dentée → **Paramètres du projet** → onglet **Général** → section *Vos
applications* → l'application Android :

| Dans la console | Variable |
|---|---|
| **Clé API** (`AIza…`) | `FIREBASE_API_KEY` |
| **ID de l'application** (`1:1234…:android:…`) | `FIREBASE_APP_ID` |
| **ID du projet** (en haut de l'onglet Général) | `FIREBASE_PROJECT_ID` |
| **Numéro du projet** (= *Sender ID*, onglet **Cloud Messaging**) | `FIREBASE_SENDER_ID` |

## 4. Activer Cloud Messaging et créer la clé du serveur

Paramètres du projet → onglet **Cloud Messaging** : l'*API Firebase Cloud
Messaging (V1)* doit être **activée** (un lien l'active si besoin).

Puis onglet **Comptes de service** → *Générer une nouvelle clé privée* →
*Générer* : un fichier JSON se télécharge. **C'est la seule copie ; il donne
le droit d'envoyer des notifications à toute l'école — ne le partager qu'avec
le serveur.**

## 5. Poser les valeurs

**Dans l'application** — `deploy/brands/elmourad.env` (les lignes
`FIREBASE_*` sont prêtes, en commentaire) puis reconstruire :

```bash
BRAND=elmourad API_URL=https://api.elmourad.mr tools/packager.sh apk
```

**Sur le serveur** — le JSON de l'étape 4, **sur une seule ligne**, dans
`deploy/elmourad/.env` :

```bash
FCM_SERVICE_ACCOUNT='{"type":"service_account","project_id":"…","private_key":"-----BEGIN PRIVATE KEY-----\n…"}'
```

puis `docker compose up -d api`. (Pour la démonstration El Ourwa sur Render :
la même valeur dans Render → le service → *Environment* → `FCM_SERVICE_ACCOUNT`.)

Le serveur dit s'il est prêt : `https://api.<domaine>/health` ne change pas,
mais le journal de l'API note « FCM non configuré » tant que la variable
manque, et rien n'est perdu entre-temps (les notifications attendent en file).

## 6. Vérifier sur un téléphone

Installer l'APK reconstruit, se connecter, puis **Profil → Notifications** :
quatre lignes doivent être vertes — *intégrées à cette version*, *permission
accordée*, *téléphone déclaré au serveur*, *le serveur envoie par Firebase*
(la dernière vient de `POST /parent/devices/status`). Puis **« Recevoir une
notification de test du serveur »** : le serveur pousse une vraie
notification à ce compte (`POST /parent/devices/test`) — fermer
l'application avant d'appuyer, et elle doit sonner et vibrer dans les
secondes qui suivent. *Tester la sonnerie et la vibration* vérifie le canal
seul, sans le serveur. Depuis le site, un message envoyé à la famille
(*Messagerie parents*) fait la même preuve.

Si « déclaré au serveur » reste rouge avec « Services Google indisponibles »,
le téléphone n'a pas les services Google (Huawei récent) : seul le sondage
de fond (15 min) reste.

## iOS, plus tard

Les notifications iOS exigent un compte développeur Apple (99 $/an), une clé
APNs (.p8) téléversée dans Firebase → Cloud Messaging, et une archive faite
sur un Mac (`tools/packager.sh ios`). Rien à faire tant qu'il n'y a pas
d'iPhone dans l'école.

## Ce qui change pour une seconde école

Chaque enseigne a son propre identifiant Android (`APP_ID`) : une seconde
école est une seconde application Android **dans le même projet Firebase**
(étape 2 refaite) ou dans un projet à elle ; le serveur de chaque école porte
son propre `FCM_SERVICE_ACCOUNT`.


## Fait le 23/09/2026 — le projet existe

Créé depuis la console avec le compte Google de l'école (organisation
supnum.mr), Analytics, Gemini et le Developer Program refusés :

| | |
|---|---|
| Projet | **El Mourad** — id `el-mourad`, numéro (Sender ID) `721820198526` |
| Application Android El Mourad | `mr.elmourad.parent` — `1:721820198526:android:e09a33ba885d11001d9a2f` |
| Application Android El Ourwa (démo Render) | `mr.elourwa.parent` — `1:721820198526:android:97c35c0c101ea4171d9a2f` |
| Clé API Android (commune au projet) | dans `deploy/brands/elmourad.env` et `deploy/brands/elourwa-demo.env` |
| API Cloud Messaging V1 | activée |
| Compte de service | `firebase-adminsdk-fbsvc@el-mourad.iam.gserviceaccount.com` — sa clé : `deploy/elmourad/secrets/fcm-service-account.json` (**hors git, hors zip** ; copie d'origine dans les Téléchargements du poste) |

Vérifié depuis le poste : la clé obtient un jeton OAuth de Google (200) et
l'API Cloud Messaging v1 l'accepte (elle n'a refusé qu'un jeton d'appareil
factice, `INVALID_ARGUMENT`, ce qui est le comportement attendu).

**Sur le serveur El Mourad** : déposer la clé dans
`deploy/elmourad/secrets/fcm-service-account.json` avant `install.sh` — le
script la lit et la passe à l'API ; rien d'autre à faire.

**Sur Render (démo El Ourwa)** : Render → le service `elourwa-demo` →
*Environment* → ajouter `FCM_SERVICE_ACCOUNT` = le contenu du même fichier
JSON sur une ligne → *Save* (le service redémarre). L'application de
démonstration se reconstruit avec `set -a; . deploy/brands/elourwa-demo.env;
set +a; tools/packager.sh apk`.

⚠ La clé de service donne le droit d'envoyer des notifications à toutes les
familles : elle ne se partage qu'avec les serveurs. Pour la révoquer :
console → Paramètres du projet → Comptes de service → *Gérer les
autorisations* → clés du compte `firebase-adminsdk-fbsvc`.
