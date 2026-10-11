# La console d'administration — elle existe déjà

> La commande : « une page cachée pour donner accès à n'importe quelle école sans
> soumettre une mise à jour ». Elle demandait d'abord de vérifier si une console
> existe dans le dépôt de l'application, et de ne **pas** la dupliquer sur le
> site si c'est le cas.

## Le constat

**La console existe** dans l'application, à `admin.<domaine>` de chaque
installation multi-établissements :

- API : `apps/api/src/platform/platform.controller.ts` (routes `/platform/*`),
  `platform.service.ts`, gardée par `ConsoleGuard` (404 sur une installation à
  école unique) et par la vérification du statut d'administrateur de plateforme,
  relue à chaque requête.
- Site : `apps/web/app/(app)/platform/` (page et formulaires).

Ce qu'elle fait aujourd'hui : **créer un établissement** (sous-domaine, nom, nom
arabe, devise, langue, couleur de thème, emoji, préfixe des reçus), **nommer son
administrateur**, **le suspendre ou le rouvrir**, gérer les administrateurs de
la plateforme, et aussi le tableau de bord cumulé, la facturation par élève et
l'entrée dans un établissement sans reconnexion (journalisée).

**Décision : le site public ne contient aucune console.** Il ne fait qu'un lien
vers elle (`console_url` dans `src/config.json`, « Console des établissements »
dans le pied de page). Une seconde console sur le site serait une seconde
surface d'attaque sur les mêmes données, et une page « cachée » par une adresse
non publiée n'est pas une protection.

## Ce qui protège déjà la console

| Exigence de la commande | Dans l'application |
|---|---|
| Mot de passe fort | Oui : politique commune (`validatePassword`), empreinte Argon2id |
| Limitation des tentatives, par compte et par adresse IP | Oui (verrouillage par compte **et** par IP) |
| Journal d'audit non modifiable depuis l'interface | Oui pour la création d'établissement, la nomination, la suspension, l'entrée/sortie, les administrateurs (`audit.record`) |
| En-têtes : CSP avec nonce, HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`, `no-store` | Oui : CSP à nonce sur le site, `no-store` inconditionnel sur l'API, HSTS en production |
| Session courte | Partiellement : jeton d'accès de 15 min, mais renouvelé pendant 90 jours |

## Ce qui manque — à décider par le propriétaire, côté application

Ces points relèvent de l'application (l'autre chantier), pas du site. Rien n'a
été modifié dans l'application pour cette commande.

1. **Second facteur (TOTP)** : absent. C'est l'écart le plus important : la
   console crée des accès à des données de mineurs.
2. **Session courte et expiration d'inactivité pour la console** : un
   administrateur de plateforme garde aujourd'hui la même durée de session
   qu'un parent (90 jours renouvelables). À réduire pour ce rôle (par exemple
   8 heures au plus, 15 minutes d'inactivité).
3. **Adresse IP dans le journal** : enregistrée pour l'entrée dans un
   établissement et la gestion des administrateurs, **pas** pour la création
   d'un établissement, la nomination de son administrateur ni la suspension.
4. **Identité visuelle** : la console pose une couleur et un **emoji** ; la
   commande veut un **logo** (fichier). Le **fuseau horaire** existe en base
   (`schools.timezone`, `Africa/Nouakchott` par défaut) mais ne se règle pas
   depuis la console.
5. **Périmètre** : la commande limite la console à créer, activer et habiller un
   établissement, sans aucune donnée d'élève. La console actuelle va plus loin
   (tableau de bord cumulé, entrée dans un établissement, qui montre ses
   élèves). À trancher : garder, ou séparer ces fonctions derrière un rôle
   distinct.

**L'application des familles** est déjà une seule application pour tous les
établissements (`docs/FEATURES.md`, ligne 127) ; qu'elle lise l'identité de
chaque établissement depuis l'API à la connexion est le travail en cours de
l'autre chantier — à coordonner sur le contrat d'API avant de figer un écran.
