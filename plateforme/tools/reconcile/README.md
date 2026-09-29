# tools/reconcile

**L'épine dorsale du projet.** El Ourwa contient des années de justesse
accumulée ; le seul étalon défendable est que le successeur produise des nombres
**identiques** à partir de données **identiques**.

```bash
# Les bulletins : El Ourwa calcule les siens, sur sa propre base.
php tools/reconcile/extraire.php > tools/reconcile/data/bulletins.jsonl

# Les effectifs, la finance, la paie : il faut que la reprise ait eu lieu.
pnpm importer --school elourwa

# La dette : chacun calcule la sienne, le même jour.
php tools/reconcile/extraire-dettes.php > tools/reconcile/data/dettes-elourwa.jsonl
pnpm --filter @elourwa/api extraire-dettes elourwa

# Puis on compare.
pnpm reconcile
pnpm reconcile --only bulletins
pnpm reconcile --only students
pnpm reconcile --only grades
pnpm reconcile --only finance
pnpm reconcile --only payroll
pnpm reconcile --only debts
pnpm reconcile --verbose            # imprime les lignes divergentes
pnpm reconcile --school elourwa     # quelle branche comparer (défaut : elourwa)
```

Sort en code 1 à la moindre divergence inexpliquée, pour qu'une chaîne
d'intégration puisse en faire une barrière (règle 23).

## Pourquoi c'est SON code qui produit le côté « legacy »

`extraire.php` appelle `bulletin_donnees()` — la fonction d'El Ourwa, sur sa
base, avec ses formules. Transcrire son arithmétique dans le vérificateur
reviendrait à tester ma transcription. Ici, il calcule, et nous comparons.

## Les règles

1. Comparer en **chaînes** ou en décimaux, **jamais** en nombres JS.
2. Une divergence est un **défaut bloquant**, pas une curiosité d'arrondi.
3. **El Ourwa a raison jusqu'à preuve du contraire.**
4. S'il a réellement tort, l'écrire dans `docs/DECISIONS.md` avec ses preuves et
   **demander avant de « corriger »** — l'école le contourne peut-être depuis des
   années.

## Divergence attendue ≠ divergence

⚠ Une barrière qui crie au loup sur le connu cesse d'être lue. `bulletins.ts`
distingue l'écart **attendu** — un marqueur d'absence est en jeu, ADR-0054 — de
l'**inexpliqué**, et ne fait échouer que sur le second.

## Ce qui est couvert

| Fichier | Compare | État |
|---|---|---|
| `checks/bulletins.ts` | moyenne de matière, moyenne générale du trimestre | ✅ 21 789 + 2 520 mesures |
| `checks/students.ts` | effectifs, répartitions, et les cinq sommes de frais | ✅ 24 mesures |
| `checks/grades.ts` | notes, enseignements, formules du bulletin | ✅ 15 mesures |
| `checks/finance.ts` | encaissements, ventilation, échéanciers, dépenses | ✅ 18 mesures |
| `checks/payroll.ts` | personnel, salaires, prêts, échéances, dettes constatées | ✅ 18 mesures |
| `checks/debts.ts` | la dette de scolarité CALCULÉE, famille par famille | ✅ 11 mesures |

**88 mesures, aucune divergence.**

La dette ne compare pas des lignes mais un CALCUL : elle n'est stockée nulle
part. Comme pour les bulletins, c'est le code d'El Ourwa qui produit son côté
(`extraire-dettes.php`, 1 372 appels à `obtenir_dette_parent_detaillee()`), et
c'est `DebtService.detailAcrossYears()` qui produit le nôtre
(`apps/api/src/finance/extraire-dettes.ts`) — la fonction que lisent la caisse et
la porte des examens, pas une requête écrite pour l'occasion. Les deux extraits
doivent dater du même jour : « un mois à venir n'est pas dû ».
Les bulletins n'en ont pas besoin — les entrées viennent d'El Ourwa et traversent
notre arithmétique directement.

## ⚠ La collation, un piège dans la vérification elle-même

El Ourwa est en `utf8mb4_unicode_ci` — **insensible à la casse et aux accents**.
Son `GROUP BY` sur du texte replie « Ksar » et « ksar », « NKT », « Nkt » et
« nkt », « Boghe » et « Boghé ». Postgres regroupe exactement.

Les empreintes des lieux de naissance divergeaient donc sur une trentaine de
clés — alors que les valeurs stockées étaient identiques : 95 + 13 + 4 = 112, et
« nkt 112 » est justement le chiffre relevé dans `CLAUDE.md`. Une vérification qui
échoue sur un réglage ne vérifie plus les données. **Tout regroupement sur du
texte est forcé en `utf8mb4_bin`** du côté MySQL — et pas seulement par confort :
sans cela, deux niveaux qui ne différeraient que par la casse seraient repliés
chez lui et un vrai écart passerait inaperçu.

## ⚠ Les données ne se versionnent pas

`data/` est ignoré par git : l'extrait porte les notes de 2 153 enfants,
nommément. Le code se versionne, ce qu'il lit jamais. Le rapport daté dans
`docs/reconciliation/` ne contient que des agrégats.

## ⚠ Le rapport ne porte aucun identifiant — y compris quand la mesure en a besoin

« notes par élève, matière et trimestre » est la mesure la plus utile du lot :
139 457 des deux côtés ne prouve rien, puisque deux notes interverties entre
deux élèves laissent le total intact et changent deux bulletins. Elle descend
donc au triplet, ce qui fait 663 770 caractères de `100:126:1=2|…`.

Or ces nombres sont des **identifiants d'enfants**, et le rapport daté est
versionné. Cette mesure compare donc deux **condensés** : ils diffèrent dès
qu'une seule clé diffère — c'est tout ce qu'on demande à une barrière — et les
clés fautives partent dans `sample`, que seul `--verbose` imprime, et qui n'est
jamais écrit sur le disque.

## Les outils communs sont testés

`checks/commun.ts` décide ce qu'on appelle « la même répartition » et comment
deux montants se comparent. Une barrière qui ne sait pas échouer n'est pas une
barrière : `commun.spec.ts` vérifie notamment qu'une empreinte distingue deux
valeurs **échangées** entre deux clés — le cas où tous les totaux restent
identiques — et qu'un condensé diverge sur une seule note déplacée.

```bash
pnpm --filter @elourwa/tools test
```
