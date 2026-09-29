# Politique de confidentialité

**Application « {{marque}} — Espace parents » et plateforme de gestion scolaire**

Dernière mise à jour : {{date}}

## 1. Qui est responsable de vos données

Le responsable du traitement est l'établissement scolaire :

- **Dénomination :** {{ecole}}
- **Adresse :** {{adresse}}
- **Contact pour toute question sur vos données :** {{courriel}}
- **Téléphone :** {{telephone}}
- **Site :** [https://{{domaine}}/](https://{{domaine}}/)

Le traitement est réalisé dans le cadre de la loi mauritanienne n° 2017-020 du
22 juillet 2017 relative à la protection des données à caractère personnel.

## 2. Ce que fait l'application

L'application permet au **correspondant** d'un élève — le parent ou le tuteur
qui répond de sa scolarité — de suivre depuis son téléphone ou son navigateur :
les notes et bulletins, les absences et retards, les exercices donnés, les
remarques des enseignants, l'emploi du temps, les messages de l'école, et
l'état de ses paiements.

L'application est destinée à des **adultes**. Elle n'est pas conçue pour être
utilisée par des enfants. Elle traite en revanche des données **concernant**
des enfants — les élèves — sous la responsabilité de leur correspondant et de
l'école (voir la section 5).

## 3. Les données traitées, et pourquoi

Tout ce qui suit est saisi par l'école, dans le cadre de l'inscription et de la
vie scolaire, ou produit par l'usage normal de l'application. **L'application ne
collecte rien d'autre.** Elle ne contient aucun outil de mesure d'audience, aucune
publicité, aucun traceur tiers.

### 3.1 Votre compte de correspondant

| Donnée | Pourquoi |
|---|---|
| Numéro de téléphone | C'est votre identifiant de connexion, et le moyen de vous joindre. |
| Nom complet | Vous identifier auprès de l'école. |
| Mot de passe | Conservé uniquement sous forme d'empreinte cryptographique (Argon2id). Personne, pas même l'école, ne peut le lire. |
| Langue choisie (français ou arabe) | Vous afficher l'application dans votre langue, sur chacun de vos appareils. |

### 3.2 Les données de vos enfants

| Donnée | Pourquoi |
|---|---|
| Nom, prénom, sexe, date et lieu de naissance | L'identité scolaire de l'élève, telle qu'inscrite par l'école. |
| Numéros RIM et NNI | Identifiants nationaux requis par l'administration scolaire mauritanienne. |
| Classe, niveau, année scolaire | Sa scolarité. |
| Notes, moyennes, bulletins, rang | Ses résultats, tels que saisis par les enseignants. |
| Absences, retards | Son assiduité, telle que relevée en classe. |
| Remarques des enseignants, exercices à faire | Le suivi pédagogique. |
| Pièces jointes des exercices | Les documents que l'enseignant partage avec la classe. |

### 3.3 Les données financières

| Donnée | Pourquoi |
|---|---|
| Frais de scolarité dus, paiements enregistrés, numéros de reçu, mois payés | Vous montrer ce qui a été réglé et ce qui reste dû. Ces écritures sont des pièces comptables de l'école. |
| {{facturation_services}} | Calculer la mensualité de l'élève et ce qui est dû pour chaque service. |
| Remises et exemptions accordées | Le montant réellement réclamé. |

### 3.4 Les données techniques

| Donnée | Pourquoi | Durée |
|---|---|---|
| Jeton de notification de votre appareil (Firebase) | Vous envoyer les notifications que vous avez acceptées. | Tant que l'application est installée et connectée ; supprimé à la déconnexion ou dès que l'appareil ne répond plus. |
| Adresse IP et type de navigateur ou d'appareil, à la connexion | Protéger votre compte : détecter les tentatives de connexion répétées et l'usage d'une session depuis un autre appareil. | Sessions : 90 jours au plus. Tentatives de connexion : 30 jours, puis effacées automatiquement. |
| Journal des actions (qui a fait quoi, quand) | La traçabilité exigée pour un système qui tient des comptes. Il enregistre les actions, jamais les mots de passe. | La durée légale de conservation des pièces comptables de l'école. |

## 4. Les notifications

Si vous les acceptez, l'application vous prévient sur votre téléphone quand une
absence est signalée, une note d'examen saisie, une remarque ajoutée, un exercice
donné, un message envoyé, un paiement enregistré ou un emploi du temps publié.

**La note de votre enfant n'apparaît jamais sur l'écran verrouillé** : la
notification annonce qu'une note a été saisie, et le chiffre se lit dans
l'application. Un écran verrouillé est lisible par quiconque tient le téléphone.

Les notifications transitent par le service Firebase Cloud Messaging de Google.
Google reçoit le jeton de votre appareil et le texte de la notification — jamais
votre numéro, ni les données de l'élève au-delà de ce que le texte annonce.
Vous pouvez les refuser à tout moment dans les réglages de votre téléphone.

## 5. Les enfants

Les élèves sont mineurs. Leurs données sont traitées par l'école dans le cadre
de sa mission d'enseignement, et rendues accessibles à leur correspondant. Un
élève n'a pas de compte et ne se connecte pas.

Ce que vous voyez d'un enfant, vous ne le voyez que parce que l'école vous a
inscrit comme son correspondant. Si ce n'est plus le cas, dites-le à l'école :
le rattachement est retiré et vous ne voyez plus rien le concernant.

## 6. Avec qui les données sont partagées

- **Le personnel de l'école**, chacun selon son rôle : un enseignant voit ses
  classes, la caisse voit les paiements, la direction voit l'ensemble. Chaque
  accès est contrôlé par le serveur, pas seulement par l'écran.
- **Notre hébergeur** : {{hebergeur}}. Il stocke les données pour notre compte et n'y accède pas.
- **Google (Firebase Cloud Messaging)** : uniquement pour acheminer les
  notifications, comme décrit en section 4.

Nous ne vendons aucune donnée. Nous n'en transmettons à aucun annonceur, à
aucun courtier, à aucun réseau social.

## 7. Sécurité

- Toutes les communications sont chiffrées (HTTPS).
- Les mots de passe sont conservés sous forme d'empreinte Argon2id.
- Chaque école est isolée des autres au niveau de la base de données : une
  requête ne peut pas, même par erreur, lire les données d'un autre
  établissement.
- Une session est liée à l'appareil qui l'a ouverte ; un changement de mot de
  passe ferme immédiatement toutes les sessions.
- Les accès sont journalisés.

Aucun système n'est infaillible. En cas de violation de données susceptible de
vous porter préjudice, l'école vous en informera dans les meilleurs délais, par
un message dans l'application et, si nécessaire, par téléphone.

## 8. Combien de temps

- **Votre compte** : tant que vous êtes le correspondant d'un élève inscrit, et
  jusqu'à ce que vous le supprimiez (section 9).
- **Les données scolaires et financières** : pendant la durée de scolarité et,
  au-delà, pendant la durée de conservation que la loi impose à l'école pour
  ses registres et ses pièces comptables.
- **Les données techniques** : voir la section 3.4.

## 9. Vos droits

Vous pouvez, à tout moment :

- **Consulter** vos données et celles de vos enfants — c'est ce que
  l'application affiche ;
- **Corriger** une information inexacte, en le demandant à l'école ;
- **Supprimer votre compte**, depuis l'application (*Profil → Supprimer mon
  compte*), après avoir saisi votre mot de passe, ou en le demandant à l'école
  (voir [la page de suppression](/legal/suppression)). Votre nom, votre numéro et
  votre identifiant sont alors effacés, votre compte est fermé et toutes vos
  sessions et appareils sont déconnectés. **Les écritures scolaires et
  comptables qui concernent vos enfants sont conservées**, sous un compte
  anonyme, parce que l'école est tenue de les garder ; elles ne permettent
  plus de vous identifier ;
- **Retirer votre consentement** aux notifications, dans les réglages de
  votre téléphone ;
- **Vous opposer** à un traitement ou **saisir l'autorité de contrôle**
  compétente : l'autorité de protection des données à caractère personnel
  instituée par la loi n° 2017-020.

Pour exercer ces droits, écrivez à l'adresse indiquée en section 1 ou adressez-vous
au secrétariat de l'école. L'école répond dans un délai d'un mois au plus.

## 10. Modifications

Cette politique peut évoluer. La date en tête de document change alors ; en cas
de changement important, l'école vous en informe par un message dans
l'application.

---

## Annexe — correspondance technique

Pour le lecteur qui veut vérifier chaque affirmation dans le code source :

| Affirmation | Où c'est vrai |
|---|---|
| Mot de passe en Argon2id, jamais lisible | `apps/api/src/auth/passwords.ts` |
| Isolation entre écoles au niveau de la base | `packages/db/migrations/0001_init.sql` — RLS forcée sur chaque table |
| Session liée à l'appareil, fermée au changement de mot de passe | `apps/api/src/auth/sessions.service.ts`, `auth.guard.ts` |
| Jeton d'appareil supprimé à la déconnexion et sur `UNREGISTERED` | `apps/api/src/push/push.service.ts` |
| La note absente de l'écran verrouillé | `packages/shared/src/notifications.ts`, `renduPourPousser()` |
| Suppression du compte : anonymisation, écritures conservées | `apps/api/src/auth/auth.service.ts`, `deleteOwnAccount()` |
| Aucun traceur, aucune publicité | aucun SDK tiers dans `apps/mobile/pubspec.yaml` ni `apps/web/package.json` hors Firebase Messaging |
