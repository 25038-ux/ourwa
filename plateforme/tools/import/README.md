# tools/import

El Ourwa MySQL (lecture seule) → Postgres.

⚠ **El Ourwa n'est jamais écrit** (règle 22). Rien ici n'émet autre chose qu'un
SELECT de son côté. Le jour où les deux systèmes acceptent des écritures, ils
divergent et la réconciliation devient impossible.

```bash
npx tsx tools/import/creer-branche.ts elourwa "El Ourwa" ELOU
pnpm importer --school elourwa --dry-run     # dit tout ce qu'il ferait, n'écrit rien
pnpm importer --school elourwa
pnpm reconcile --only students             # et on vérifie
```

## ⚠ La branche doit être vierge

L'import **refuse** une branche qui contient déjà des lignes créées ici — `legacy_id IS NULL`
dans les tables qui en ont un, `origin <> 'migrated'` dans les autres.
Ce n'est pas de la prudence théorique : lancé sur « École Nour », il s'est heurté à
la contrainte d'unicité des années scolaires, parce que le peuplement de
démonstration en avait déjà une pour 2025-2026. Mélanger 2 153 dossiers réels aux
200 élèves inventés d'une branche de test rendrait tout total indéfendable.

Ce qui est **déjà repris** ne compte pas : relancer l'import sur sa propre sortie
doit rester possible. Voir **ADR-0055**.

## Ce qui est repris, dans l'ordre des dépendances

| Étape | Source | Cible | Lignes |
|---|---|---|---|
| configuration | `configuration` | `configuration` | 2 sur 7 |
| années | `annees_scolaires` | `academic_years` | 7 |
| mois facturés | `annee_scolaire_mois` | `academic_year_months` | 45 |
| niveaux | `niveaux` | `levels` | 20 |
| formules | `bulletin_formules` | `bulletin_formulas` | 60 |
| groupes | `groupes` | `groups` | 38 |
| matières | `matieres` | `subjects` | 167 |
| personnel | `utilisateurs` | `users` + `user_school_roles` | 4 |
| professeurs | `professeurs` | `teachers` | 2 |
| enseignements | `enseignements` | `teachings` | 504 |
| correspondants | `parents` | `users` + `user_school_roles` | 1 372 |
| élèves | `etudiants` | `students` | 2 153 |
| inscriptions | `etudiant_inscriptions` | `enrollments` | 3 500 |
| notes | `notes` | `grades` | 139 457 |
| moyens | `moyens_paiement` | `payment_methods` | 7 |
| échéancier | `inscription_mois` | `enrollment_months` | 28 881 |
| encaissements | `paiements` | `payments` | 15 989 |
| ventilation | `paiement_lignes` | `tender_lines` | 16 008 |
| dépenses | `depenses` | `expenses` | 24 |
| personnel admin. | `staff` | `staff` | 67 |
| salaires | `paiements_salaire` | `salary_payments` | 211 sur 550 |
| prêts · échéances | `prets_personnel` · `prets_echeances` | `staff_loans` · `loan_instalments` | 1 124 · 1 196 |
| dettes diverses | `dettes_familles` | `misc_debts` | 1 357 |

**212 196 lignes**, en soixante-dix secondes. `exemptions`, `reductions`,
`remises_dette`, les frais annuels par famille et tout le cours du soir sont
vides dans la référence : les étapes existent, elles n'ont rien lu.

**Rien ne reste à reprendre** de ce qui contient des données.

## Les cinq exigences

1. **Idempotent.** Rapproché sur `legacy_id`, jamais sur la clé naturelle : un
   groupe renommé chez lui doit être mis à jour, pas dupliqué. Deuxième passage :
   0 créée, 147 331 mises à jour.

   ⚠ Une exception, les **notes** : 139 457 lignes ne s'écrivent pas une par une
   — ce serait 280 000 allers-retours. Elles passent par `unnest`, mille à la
   fois, avec `ON CONFLICT` sur la clé naturelle, qui EST l'identité d'une note :
   élève, enseignement, trimestre, nature, numéro. Une note ne se « renomme » pas.

   ⚠ **Et la reprise n'est pas un miroir.** Une ligne supprimée chez lui ne
   disparaît pas ici à la relance ; c'est le décompte de la réconciliation qui le
   dirait. Un import qui supprimerait des lignes serait bien plus dangereux qu'un
   import qui en laisse.
2. **Ordonné** par dépendance (tableau ci-dessus).
3. **Correspondance persistée** dans `legacy_id`. Exception `users`, qui est
   globale et n'en a pas : le rapprochement se fait sur le téléphone.
4. **Chaque décision se journalise** — défauts, lignes écartées, champs sans
   destination.
5. **`--dry-run`** fait tout le travail dans une transaction annulée : les comptes
   affichés sont réels, pas estimés.

## Les pièges, et ce qui les traite

- **Jeu de caractères.** `utf8mb4_unicode_ci`. Trois noms accentués ou arabes sont
  affichés **avant** d'écrire quoi que ce soit : si la connexion se négociait en
  `latin1`, l'import « réussirait » avec 2 153 noms mutilés.
- **Dates.** MySQL `datetime` ne porte pas de fuseau, et Node l'interpréterait
  dans celui de la machine. L'école vit à `Africa/Nouakchott` — UTC+0 sans heure
  d'été — donc la valeur est déjà UTC et on le dit à Postgres. Un décalage d'une
  heure ferait passer une inscription du 1er octobre au 30 septembre, donc
  changerait le premier mois dû.
- **Argent.** `mysql2` rend les `DECIMAL` en chaîne, `pg` les relit en chaîne, et
  `montant()` **lève** si une valeur arrive en `number` (règle 6).
- **`lieu_naissance` → `place_of_birth`**, pas `address` : ce sont des lieux de
  naissance, pas des adresses (migration 0018).
- **Le marqueur d'absence passe INCHANGÉ.** 1 580 notes valent `-1` ; c'est un
  MARQUEUR, pas une note (règle 11). Le filtrer à l'import perdrait
  l'information « absent » — c'est le CALCUL qui l'exclut.
- **Un identifiant de connexion n'est pas toujours une adresse.** Trois des
  quatre comptes du personnel se connectent avec `e.historique`, `s.employ339`,
  `parite_lab`. Repris tels quels dans `email`, pour qu'ils tapent la même chose
  qu'aujourd'hui. Pis-aller assumé : voir **ADR-0056**.
- **Empreintes de mot de passe** reprises telles quelles : 1 370 `$2y$` bcrypt et
  2 `$argon2id$`. Forcer une réinitialisation bloquerait 1 372 familles d'un coup.
- **`origine`** → `origin = 'migrated'` sur tout. C'est ce qui distingue ce que
  l'école a saisi de ce qu'elle a hérité — et c'est aussi ce sur quoi repose le
  refus d'une branche non vierge.

## Ce qui n'a pas de destination

Compté à chaque passage plutôt que perdu de vue : 128 `telephone2`, 40
`nom_secondaire`, 7 `nni` de parents, 2 153 `identifiant` d'élèves,
`professeurs.nb_classes` et `heures_par_mois` (compteurs dérivés, ils se
recalculent), `enseignements.prix_par_heure` (nul partout aujourd'hui, mais la
paie le lira le jour où quelqu'un le remplira), `bulletin_formules.mode_calcul`
(aucun lecteur dans tout son source) et `annee_materialisee` — un
`annees_scolaires.id` MySQL, qui recopié donnerait une clé morte déguisée en clé
vivante.

Voir **ADR-0055** et **ADR-0056**. Deux questions sont posées à l'école : les
seconds téléphones servent-ils à joindre les familles, et faut-il une colonne
`username` pour les identifiants de connexion ?
