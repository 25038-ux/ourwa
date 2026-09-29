# Jinan — ce qui est fait, ce qui reste à faire

*État au 29/09/2026, soir. École : Heavenly Private Educational Institution
(Jinan), 465 E Nord, Tevragh Zeina, Nouakchott · infoheavenly24@gmail.com ·
+222 46 33 02 42.*

Jinan est une installation « école unique » (comme El Mourad, sans console de
plateforme), avec sa facturation : **deux modes d'étude** (8h – 14h /
8h – 17h) au tarif différent par niveau, **frais d'inscription par niveau et par
élève**, **services optionnels par élève** (cantine en 3 formules, piscine,
docteur, photocopie), chacun exemptable seul, et une page **« Frais »**.
Spécification : [specs/jinan-facturation.md](specs/jinan-facturation.md) ·
décisions : ADR-0073 (+ addendum), ADR-0074 (absences du personnel), ADR-0075
(IP et domaine) dans [DECISIONS.md](DECISIONS.md).

---

## 1. FAIT

| Quoi | Où |
|---|---|
| Base et API de la facturation « services » (0042) | `packages/db/migrations/0042_…`, `apps/api/src/finance/` |
| **Interface web complète** : page Frais, inscription (mode obligatoire, mensualité par niveau + mode, frais d'inscription, services), réinscription (modale, recherche, en lot), fenêtre d'encaissement (services à cocher, total en décimal), fiche du correspondant (bloc Services, sous-lignes de mois, Reçu, ✕, exempter, arrêter, ajouter, changer de mode), reçu groupé, note des impayés | `apps/web/…` — ADR-0073 addendum |
| **Absences des professeurs et des agents**, d'après leur emploi du temps (grille des classes ; horaires des agents), justification par la direction, synthèse du mois — pour toutes les écoles, sans effet sur la paie | 0043, `apps/api/src/personnel/`, `/personnel/absences` — ADR-0074 |
| École « services » de développement (jamais en production) | `pnpm --filter @elourwa/db seed:jinan` |
| Tests du navigateur : `jinan-facturation.spec.ts` (8), `absences-personnel.spec.ts` (4) ; `toutes-les-pages` ouvre aussi les absences | `apps/web/e2e/` |
| **L'IP et le domaine de production en un seul endroit** | `deploy/jinan/configurer-production.sh` — ADR-0075 |
| Enseigne, logo, icônes, visuels et textes Play Store, pages légales, déploiement, clé de signature | voir ADR-0073 ; `deploy/jinan/`, `docs/store/jinan/` |

---

## 2. RESTE À FAIRE — dans cet ordre

### A. Hébergement et domaine (le propriétaire)
Recommandé : **Namecheap VPS « Pulsar »** (2 vCPU, 2 Go, 40 Go SSD), Ubuntu
24.04, emplacement européen si proposé ; domaine dans le même compte (ex.
`jinan-ecole.com`). Trois enregistrements **A** — `@`, `www`, `api` → l'IP du
VPS ; **aucun AAAA**.

### B. Donner l'IP et le domaine au dépôt (une commande)

    bash deploy/jinan/configurer-production.sh <ip-du-vps> <domaine> namecheap-eu

(`hostinger-eu` / `namecheap-us` selon l'hébergeur réel.) Puis commiter
`deploy/jinan/production.env` et `deploy/brands/jinan.env`.

### C. Mise en ligne
1. `BRAND=jinan bash tools/packager.sh zip` → `dist/jinan-<version>.zip`.
2. Première installation : `deploy/jinan/README.md` §1–§2 (le domaine est lu
   dans `production.env`).
3. Sur le site : Années scolaires → Gestion de scolarité (niveaux, classes,
   matières) → **Frais** → moyens de paiement → comptes du personnel →
   **Absences du personnel → Horaires des agents**.
4. Mises à jour ensuite, sans arguments : `bash deploy/jinan/mettre-a-jour.sh`
   ou `mettre-a-jour.ps1`.

### D. Application Android (une fois le site en ligne)
`API_URL` / `WEB_URL` sont écrits par l'étape B. Puis
`BRAND=jinan bash tools/packager.sh android` (`.aab`) et `… apk` (essais) ;
Play Console : `docs/store/jinan/PLAY-CONSOLE.md`. Notifications (facultatif) :
lignes `FIREBASE_*` de `deploy/brands/jinan.env`.

### E. Décisions — tranchées par le propriétaire le 29/09
D1–D6 (règle du 25, dettes de services bloquantes, remises sur la scolarité
seule, niveau sans frais d'inscription refusé, arrêt après annulation, services
dus malgré la gratuité) : **gardées**. Les absences du personnel **ne réduisent
pas** le salaire. La secrétaire **lit** la liste des moyens de paiement (fait,
ADR-0076).

### F. Facultatif
- Relecture adverse de l'API de facturation (argent, isolation, parité El
  Mourad, cohérence de la dette).
