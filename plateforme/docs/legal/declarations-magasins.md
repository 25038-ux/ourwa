# Ce qu'il faut déclarer aux magasins — et ce qui est déjà fait

> Les deux magasins posent des questionnaires dont les réponses **doivent
> correspondre à la politique de confidentialité et au code**. Une réponse
> fausse est un motif de retrait. Tout ce qui suit est dérivé du code source ;
> chaque ligne indique où c'est vrai.

## Google Play — « Sécurité des données » (Data safety)

| Question | Réponse | Où c'est vrai |
|---|---|---|
| L'application collecte-t-elle ou partage-t-elle des données utilisateur ? | **Oui** | — |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** (HTTPS obligatoire) | `apps/api/src/security-headers.ts` (HSTS), déploiement TLS |
| Un mécanisme de suppression des données existe-t-il ? | **Oui**, dans l'application | `POST /auth/delete-account`, *Profil → Supprimer mon compte* |
| **Informations personnelles — Nom** | Collecté, obligatoire, pour la fonctionnalité de l'application et la gestion du compte. Non partagé. | `users.full_name` |
| **Informations personnelles — Numéro de téléphone** | Collecté, obligatoire, gestion du compte (identifiant de connexion). Non partagé. | `users.phone` |
| **Informations personnelles — Autres infos** (RIM, NNI, date et lieu de naissance de l'élève) | Collecté par l'école, obligatoire, fonctionnalité de l'application. Non partagé. | `students.rim`, `national_id`, `date_of_birth`, `place_of_birth` |
| **Infos financières — Historique des achats** (paiements de scolarité) | Collecté, fonctionnalité. Non partagé. | `payments`, `enrollment_months` |
| **Messages** (messages de l'école, remarques) | Collecté, fonctionnalité. Non partagé. | `messages`, `remarks` |
| **Fichiers et documents** (pièces jointes des exercices) | Collecté, fonctionnalité. Non partagé. | `attachments` |
| **ID de l'appareil ou autres** (jeton de notification) | Collecté, fonctionnalité (notifications). **Partagé** avec Google (Firebase Cloud Messaging) pour la livraison. | `device_tokens`, `push.service.ts` |
| **Journaux de plantage / diagnostics** | Non collectés | aucun SDK |
| **Position, contacts, photos, micro, calendrier, santé** | Non collectés | aucune permission |
| Données concernant des enfants | **Oui** : l'application est destinée aux parents, mais traite les résultats et l'assiduité de mineurs. Public cible : adultes (18+). | politique §5 |

Permissions Android — lire le manifeste FUSIONNÉ du paquet, pas seulement
`android/app/src/main/AndroidManifest.xml` : les bibliothèques en ajoutent.

- Demandée à la personne : `POST_NOTIFICATIONS` (Android 13+), et c'est la seule.
- Accordées à l'installation, sans question (permissions « normales », aucune
  déclaration Play) : `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `VIBRATE`,
  `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE` (WorkManager, jamais utilisée :
  la tâche de fond est périodique, sans premier plan), `com.google.android.c2dm.permission.RECEIVE`
  (Firebase), et la permission interne `<id>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- ⚠ RETIRÉES depuis 0.7.2 (`tools:node="remove"`) : `READ_EXTERNAL_STORAGE`,
  `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`, qu'`open_filex`
  ajoutait. Le paquet 0.7.1+10 les portait : refus assuré au titre de la règle
  « Autorisations d'accès aux photos et vidéos ». `tools/packager.sh android`
  vérifie désormais qu'elles sont absentes du `.aab`.
- Pas d'identifiant publicitaire (`AD_ID` absent) : répondre « Non » à la
  question « Identifiant publicitaire » de la Play Console.

## App Store — « Confidentialité de l'app » (App Privacy « nutrition label »)

Types de données, tous **« liés à l'utilisateur »** (associés au compte) et
**aucun utilisé pour du suivi** (tracking) :

| Type | Collecté | Usage |
|---|---|---|
| Coordonnées — Nom | Oui | Fonctionnalité de l'app |
| Coordonnées — Numéro de téléphone | Oui | Fonctionnalité de l'app |
| Infos financières — Historique des paiements | Oui | Fonctionnalité de l'app |
| Contenu utilisateur — Autre contenu (résultats scolaires, absences, remarques) | Oui | Fonctionnalité de l'app |
| Identifiants — ID de l'appareil (jeton de notification) | Oui | Fonctionnalité de l'app |
| Données de diagnostic | Non | — |
| Données d'utilisation / analyses | Non | — |

**Suivi (tracking) : Non.** Pas d'IDFA, pas de publicité, pas de SDK
publicitaire — `NSPrivacyTracking = false`.

Fichier `PrivacyInfo.xcprivacy` : fourni dans `ios/Runner/PrivacyInfo.xcprivacy`
avec les motifs d'API requis (UserDefaults pour la langue, horodatages de
fichiers pour le cache Flutter).

**Chiffrement à l'export** : l'application n'utilise que HTTPS standard —
`ITSAppUsesNonExemptEncryption = false` dans `Info.plist`, ce qui dispense de
la déclaration annuelle.

**Suppression de compte** (App Store Review 5.1.1(v)) : présente dans
l'application, sans passer par un site externe ni un courriel.

**Connexion** : l'application n'offre pas de connexion sociale, donc la règle
« Sign in with Apple » (4.8) ne s'applique pas.

## Ce que l'école doit fournir avant de soumettre

Rien de ce qui suit ne peut être inventé par un développeur :

1. **Un compte développeur** Apple (99 $/an, personne morale : numéro D-U-N-S)
   et Google Play (25 $ une fois). Au nom de l'école ou du titulaire des droits.
2. **La raison sociale, l'adresse et une adresse électronique** de contact,
   pour les fiches de magasin et pour remplir les `[À COMPLÉTER]` des deux
   politiques.
3. **Une URL publique** où la politique de confidentialité est lisible sans
   se connecter. La plateforme la sert à `/legal/confidentialite`
   (`apps/web/app/legal/`) ; il faut le domaine.
4. **Un projet Firebase** pour les notifications : le compte de service
   (`FCM_SERVICE_ACCOUNT` côté serveur), et les quatre valeurs de configuration
   (`--dart-define`) côté application. Pour iOS, la clé APNs (.p8) téléversée
   dans Firebase.
5. **Une clé de signature Android** (`keytool`), conservée hors du dépôt et
   sauvegardée : la perdre, c'est ne plus jamais pouvoir mettre à jour
   l'application.
6. **Un Mac avec Xcode** pour l'archive iOS — un projet iOS ne se construit
   pas sous Windows.
7. **Captures d'écran** et textes de fiche, en français et en arabe.
8. **La relecture juridique** des deux politiques, notamment les durées de
   conservation et la référence à l'autorité de contrôle mauritanienne.
