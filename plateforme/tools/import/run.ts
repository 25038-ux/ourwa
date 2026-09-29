import mysql from 'mysql2/promise';
import pg from 'pg';
import {
  decision,
  decisions,
  etapes,
  horodatage,
  jour,
  montant,
  noter,
  reprendre,
  type Carte,
  DECISION,
  MYSQL,
  POSTGRES,
  STATUT,
} from './commun.js';
import { importerFinance } from './finance.js';
import { importerPaie } from './paie.js';

/**
 * EL OURWA (MySQL) → POSTGRES. La reprise des données.
 *
 * ```bash
 * pnpm importer --dry-run          # dit tout ce qu'il ferait, n'écrit rien
 * pnpm importer                    # écrit
 * pnpm importer --school nour      # dans quelle branche (défaut : nour)
 *
 * ⚠ Le script s'appelle « importer » et non « import » : `pnpm import` est une
 * commande native de pnpm, qui répondait « Unknown options » sur nos arguments.
 * ```
 *
 * ⚠ EL OURWA N'EST JAMAIS ÉCRIT (règle 22). Pas une fois, pas « juste un
 * drapeau pour marquer ce qui est repris », pas de synchronisation en retour.
 * Rien ici n'émet autre chose qu'un SELECT de son côté. Le jour où les deux
 * systèmes acceptent des écritures, ils divergent et la réconciliation devient
 * impossible.
 *
 * ⚠ ET ON SE CONNECTE EN `app_user`, PAS EN `postgres`. Le propriétaire de la
 * base est superutilisateur, et un superutilisateur CONTOURNE RLS même quand
 * elle est FORCE : la reprise paraîtrait cloisonnée sans l'être, et une erreur
 * d'école ne serait pas rattrapée. `app_user` est NOBYPASSRLS, donc la politique
 * vérifie réellement chaque ligne écrite ici. Ses droits DML suffisent (0001,
 * section Grants).
 *
 * ## Les cinq exigences du README
 *
 * 1. **Idempotent.** Chaque table est rapprochée par `legacy_id` puis mise à
 *    jour ; deux passages donnent le même état. C'est ce qui rend une bascule
 *    répétable — on importe, on réconcilie, on corrige, on réimporte.
 * 2. **Ordonné par dépendance** : année → mois facturés → niveau → formule →
 *    groupe → matière → personnel → professeur → enseignement → correspondant →
 *    élève → inscription → note.
 * 3. **La correspondance d'identifiants est persistée** dans `legacy_id`
 *    lui-même, ce qui évite une table de correspondance à tenir à jour. Une
 *    exception, `users` : voir `importerCorrespondants()`.
 * 4. **Chaque décision se journalise** — les défauts appliqués, les lignes
 *    écartées, et les colonnes qui n'ont pas de destination.
 * 5. **Simulation** : `--dry-run` fait tout le travail dans une transaction
 *    annulée à la fin, donc les comptes affichés sont réels et non estimés.
 *
 * ## Ce qui n'est PAS encore repris
 *
 * Les paiements, les dettes, la paie et le cours du soir. Ils dépendent tous de
 * ce qui est ici — un paiement pointe une inscription — et arrivent dans les
 * tranches suivantes. `checks/students.ts` et `checks/grades.ts` vérifient
 * celles-là avant qu'on aille plus loin.
 *
 * ⚠ ET LA REPRISE N'EST PAS UN MIROIR. Une ligne supprimée chez lui ne
 * disparaît pas ici à la relance ; c'est le décompte de la réconciliation qui le
 * dirait. Un import qui supprimerait des lignes serait bien plus dangereux qu'un
 * import qui en laisse.
 */

const args = process.argv.slice(2);
const simulation = args.includes('--dry-run');
const slug = args.includes('--school') ? args[args.indexOf('--school') + 1]! : 'nour';

// ══ Le déroulé ═════════════════════════════════════════════════════════════

async function principal() {
  console.log(
    `\nReprise El Ourwa → « ${slug} »${simulation ? '   [SIMULATION — rien ne sera écrit]' : ''}\n`,
  );

  const my = await mysql.createConnection({ ...MYSQL, dateStrings: true });
  const pool = new pg.Pool({ connectionString: POSTGRES });

  try {
    await verifierJeuDeCaracteres(my);

    const { rows: ecoles } = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM schools WHERE slug = $1',
      [slug],
    );
    const ecole = ecoles[0];
    if (!ecole) {
      throw new Error(
        `Aucune branche « ${slug} » dans Postgres. Créez-la d’abord, ou passez --school.`,
      );
    }
    console.log(`\n  branche : ${ecole.name}\n`);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // ⚠ `set_config(..., true)` — local à la transaction (règle 2). Un `SET`
      // nu resterait sur la connexion du pool et fuiterait dans la suivante.
      await c.query("SELECT set_config('app.current_school_id', $1, true)", [ecole.id]);

      await verifierBrancheVierge(c, ecole.id, ecole.name);

      await importerConfiguration(my, c, ecole.id);
      const annees = await importerAnnees(my, c, ecole.id);
      await importerMoisFactures(my, c, ecole.id);
      const niveaux = await importerNiveaux(my, c, ecole.id);
      await importerFormules(my, c, ecole.id, niveaux);
      const groupes = await importerGroupes(my, c, ecole.id, niveaux);
      const matieres = await importerMatieres(my, c, ecole.id, niveaux);
      const personnel = await importerPersonnel(my, c, ecole.id);
      const professeurs = await importerProfesseurs(my, c, ecole.id, personnel);
      const enseignements = await importerEnseignements(
        my, c, ecole.id, professeurs, groupes, matieres, annees,
      );
      const correspondants = await importerCorrespondants(my, c, ecole.id);
      const eleves = await importerEleves(my, c, ecole.id, correspondants);
      const inscriptions = await importerInscriptions(
        my, c, ecole.id, eleves, annees, groupes, niveaux,
      );
      await importerNotes(my, c, ecole.id, eleves, enseignements, annees);
      await importerFinance(
        my, c, ecole.id, eleves, annees, inscriptions, correspondants, personnel,
      );
      await importerPaie(my, c, ecole.id, professeurs, personnel, eleves, correspondants);

      await c.query(simulation ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  } finally {
    await my.end();
    await pool.end();
  }

  if (decisions.length) {
    console.log('\n  Décisions et défauts appliqués');
    for (const d of decisions) console.log(`    · ${d}`);
  }

  const creees = etapes.reduce((a, e) => a + e.creees, 0);
  const majs = etapes.reduce((a, e) => a + e.majs, 0);
  console.log(
    simulation
      ? `\n  SIMULATION : ${creees} lignes auraient été créées, ${majs} mises à jour.` +
          ' Transaction annulée.\n'
      : `\n  ${creees} lignes créées, ${majs} mises à jour.\n`,
  );
}

/**
 * ⚠ UNE BRANCHE QUI CONTIENT DÉJÀ DES DONNÉES PROPRES NE SE REPREND PAS.
 *
 * Le refus vient de la première tentative réelle : lancé sur « École Nour », qui
 * est une école de démonstration semée avec 600 élèves inventés, l'import s'est
 * heurté à `academic_years_school_id_label_key` — deux années « 2025-2026 », la
 * semée et la reprise. La contrainte a fait son travail, et la bonne réponse
 * n'est pas de la contourner : c'est de ne pas mélanger 2 153 dossiers réels
 * avec des enfants qui n'existent pas. Dans un système financier, une fois les
 * deux confondus, plus aucun total n'est défendable.
 *
 * C'est aussi ce que dit la règle de cloisonnement : l'école n°1 se reprend sous
 * un `school_id` à elle, et toute branche ultérieure part vierge. Il n'y a donc
 * jamais de problème de fusion — à condition de refuser ici.
 *
 * ⚠ CE QUI EST DÉJÀ REPRIS NE COMPTE PAS. On ne regarde que les lignes
 * `origin <> 'migrated'` : relancer l'import sur sa propre sortie doit rester
 * possible, c'est même tout l'intérêt d'être idempotent.
 */
async function verifierBrancheVierge(c: pg.PoolClient, ecole: string, nom: string) {
  // ⚠ LE TEST PORTE SUR `legacy_id`, PAS SUR `origin`, et ce n'était pas le cas
  // au départ. `origin` dit d'où vient une ligne POUR EL OURWA : un encaissement
  // saisi à la main chez lui arrive ici en `native`, et un encaissement
  // reconstitué en `imputed` — c'est la distinction sur laquelle ses rapports
  // financiers s'appuient, et 17 106 lignes en dépendent. Chercher
  // `origin <> 'migrated'` refusait donc la deuxième reprise de sa propre sortie.
  //
  // `legacy_id` répond à la vraie question : cette ligne a-t-elle été créée ICI ?
  const tables = [
    'academic_years',
    'levels',
    'groups',
    'subjects',
    'students',
    'enrollments',
    'enrollment_months',
    'bulletin_formulas',
    'teachers',
    'teachings',
    'grades',
    'academic_year_months',
    'payment_methods',
    'payments',
    'tender_lines',
    'expenses',
    'exemptions',
    'discounts',
    'debt_write_offs',
    'family_fee_payments',
    'staff',
    'salary_payments',
    'staff_loans',
    'loan_instalments',
    'misc_debts',
  ];
  // ⚠ TOUTES N'ONT PAS `legacy_id`. `payment_methods` et `academic_year_months`
  // n'en portent pas — leur clé naturelle EST leur identité. On demande donc au
  // catalogue plutôt que de tenir une liste à jour à la main : une table ajoutée
  // plus tard sans `legacy_id` ferait autrement échouer la reprise sur
  // « column does not exist », ce qui est arrivé.
  const { rows: colonnes } = await c.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'legacy_id'
        AND table_name = ANY($1::text[])`,
    [tables],
  );
  const aUnLegacyId = new Set(colonnes.map((r) => r.table_name));

  const occupees: string[] = [];
  for (const t of tables) {
    const temoin = aUnLegacyId.has(t) ? 'legacy_id IS NULL' : `origin <> 'migrated'`;
    const { rows } = await c.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${t} WHERE school_id = $1 AND ${temoin}`,
      [ecole],
    );
    if (rows[0]!.n !== '0') occupees.push(`${t} (${rows[0]!.n})`);
  }

  if (occupees.length === 0) return;
  throw new Error(
    `« ${nom} » contient déjà des données qui ne viennent pas d’El Ourwa :\n` +
      `    ${occupees.join(', ')}\n\n` +
      '  Une reprise se fait dans une branche vierge. Mélanger des dossiers réels\n' +
      '  avec des données semées rend tout total indéfendable, et la réconciliation\n' +
      '  impossible à interpréter. Créez la branche, puis relancez avec --school.',
  );
}

/**
 * ⚠ AVANT D'ÉCRIRE QUOI QUE CE SOIT. El Ourwa est en `utf8mb4_unicode_ci` ; si
 * la connexion se négociait en `latin1`, 2 153 noms arriveraient mutilés et rien
 * ne le signalerait — l'import « réussirait ». On lit donc quelques lignes
 * connues et on les montre : le contrôle est visuel, mais il est fait au bon
 * moment, avant les deux mille suivantes.
 */
async function verifierJeuDeCaracteres(my: mysql.Connection) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT prenom, nom FROM etudiants
      WHERE nom RLIKE '[À-ÿ]' OR prenom RLIKE '[À-ÿ]' OR nom RLIKE '[ء-ي]'
      LIMIT 3`,
  );
  if (!lignes.length) {
    decision('aucun nom accentué ou arabe trouvé pour contrôler le jeu de caractères');
    return;
  }
  console.log('  jeu de caractères — ces noms doivent être lisibles :');
  for (const l of lignes) console.log(`    ${l.prenom} ${l.nom}`);
}

/**
 * LA CONFIGURATION — mais pas toute.
 *
 * `fees.service.ts` le dit déjà : « les noms de clés d’El Ourwa sont français et
 * sont conservés, parce qu’un import lira plus tard les mêmes lignes ». C’est ce
 * qui se passe ici pour `frais_inscription` et `frais_photocopie`, y compris
 * leurs variantes par année, qui déterminent ce qu’une famille doit à
 * l’inscription.
 *
 * ⚠ `annee_materialisee` NE SE REPREND PAS, ET C’EST VOLONTAIRE. Elle vaut
 * « 4 » — un `annees_scolaires.id` de MySQL. Ici les années sont des UUID :
 * recopier ce « 4 » donnerait un pointeur qui ne désigne rien, mais qui EN A
 * L’AIR. Une clé morte qui ressemble à une clé vivante est pire que son absence.
 *
 * `dette_mois_depuis_annee` a trouvé son lecteur : `DebtService.perimetreScolarite()`
 * coupe la scolarité due avant cette année-là — « les années antérieures n’ont ni
 * facture ni paiement repris ; les compter fabriquerait une dette qui n’a jamais
 * existé » (ADR-0057).
 *
 * Les autres clés n’ont aucun lecteur de ce côté : le marqueur d’absence et le
 * mode de calcul du bulletin sont dans `@elourwa/shared` et dans
 * `bulletin_formulas`, pas dans `configuration`. On les nomme dans le journal
 * plutôt que de les laisser disparaître en silence.
 */
async function importerConfiguration(my: mysql.Connection, c: pg.PoolClient, ecole: string) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>('SELECT cle, valeur FROM configuration');
  const reprises = /^(frais_inscription|frais_photocopie)(_\d{4})?$|^dette_mois_depuis_annee$/;
  let creees = 0;
  let majs = 0;
  const laissees: string[] = [];
  for (const l of lignes) {
    if (!reprises.test(l.cle)) {
      laissees.push(l.cle);
      continue;
    }
    // ⚠ `rowCount` VAUT 1 DANS LES DEUX CAS avec DO UPDATE, ce qui annonçait
    // « 2 créées » à chaque relance. `xmax = 0` distingue réellement l'insérée
    // de la mise à jour, et c'est ce qui rend le journal lisible d'un passage
    // à l'autre.
    const { rows } = await c.query<{ cree: boolean }>(
      `INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (school_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING (xmax = 0) AS cree`,
      [ecole, l.cle, String(l.valeur)],
    );
    if (rows[0]!.cree) creees += 1;
    else majs += 1;
  }
  if (laissees.length) {
    decision(`configuration non reprise, sans lecteur ici : ${laissees.join(', ')}`);
  }
  noter({ nom: 'configuration', lues: lignes.length, creees, majs, ecartees: laissees.length });
}

async function importerAnnees(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, libelle, annee_debut, mois_debut, mois_fin, statut, date_cloture
       FROM annees_scolaires ORDER BY annee_debut`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  for (const l of lignes) {
    const { id, cree } = await reprendre(c, 'academic_years', ecole, l.id, {
      label: l.libelle,
      start_year: l.annee_debut,
      start_month: l.mois_debut,
      end_month: l.mois_fin,
      // Son énumération est ('future','active','cloturee') ; la nôtre dit 'closed'.
      status: l.statut === 'cloturee' ? 'closed' : l.statut,
      closed_at: horodatage(l.date_cloture),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'années', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

/**
 * LES MOIS RÉELLEMENT FACTURÉS — `annee_scolaire_mois`.
 *
 * ⚠ SA TABLE EST DATÉE EN ANNÉE CIVILE, PAS EN ANNÉE SCOLAIRE. Elle porte
 * `(mois, annee)` sans `annee_id` : octobre 2023 et janvier 2024 appartiennent
 * tous deux à l'année scolaire 2023-2024. Le rattachement se déduit du mois de
 * début — au-dessus, c'est l'année civile de départ ; en dessous, la suivante.
 *
 * ⚠ ET UN MOIS DÉCOCHÉ NE S'IMPORTE PAS. `actif = 0` veut dire « on ne facture
 * pas ce mois-là » ; l'écrire ici le rendrait payable pour chaque famille à la
 * fois. Vide veut dire l'étendue `start_month..end_month`, pas « aucun mois »
 * (migration 0016) — ce qui tombe juste : les deux années les plus anciennes
 * n'ont aucune ligne et doivent continuer à se comporter comme aujourd'hui.
 */
async function importerMoisFactures(my: mysql.Connection, c: pg.PoolClient, ecole: string) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT mois, annee, actif FROM annee_scolaire_mois ORDER BY annee, mois',
  );
  const { rows: annees } = await c.query<{ id: string; start_year: number; start_month: number }>(
    'SELECT id, start_year, start_month FROM academic_years WHERE school_id = $1',
    [ecole],
  );
  const parAnneeDebut = new Map(annees.map((a) => [a.start_year, a]));

  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let decochees = 0;
  for (const l of lignes) {
    if (!l.actif) {
      decochees += 1;
      continue;
    }
    // Un mois au-delà du mois de début appartient à l'année scolaire ouverte
    // cette année civile-là ; en deçà, à la précédente.
    const candidate = parAnneeDebut.get(l.annee);
    const anneeScolaire =
      candidate && l.mois >= candidate.start_month ? candidate : parAnneeDebut.get(l.annee - 1);
    if (!anneeScolaire) {
      ecartees += 1;
      continue;
    }
    const { rowCount } = await c.query(
      `INSERT INTO academic_year_months (school_id, academic_year_id, calendar_month, origin)
       VALUES ($1, $2, $3, 'migrated')
       ON CONFLICT (school_id, academic_year_id, calendar_month) DO NOTHING`,
      [ecole, anneeScolaire.id, l.mois],
    );
    // DO NOTHING rend bien `rowCount` à zéro quand la ligne est déjà là.
    if (rowCount) creees += 1;
    else majs += 1;
  }
  if (decochees) decision(`${decochees} mois décoché(s) non repris — ils ne sont pas facturés`);
  if (ecartees) decision(`${ecartees} mois sans année scolaire correspondante — écarté(s)`);
  noter({ nom: 'mois facturés', lues: lignes.length, creees, majs, ecartees });
}

async function importerNiveaux(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, nom, tarif_mensuel, fondamental, seuil_eliminatoire, cycle, ordre
       FROM niveaux ORDER BY cycle, ordre, id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  for (const l of lignes) {
    const { id, cree } = await reprendre(c, 'levels', ecole, l.id, {
      name: l.nom,
      monthly_rate: montant(l.tarif_mensuel),
      is_fondamental: Boolean(l.fondamental),
      pass_mark: montant(l.seuil_eliminatoire, '10'),
      cycle: l.cycle,
      sort_order: l.ordre,
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'niveaux', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

async function importerGroupes(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  niveaux: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, nom, niveau_id, capacite FROM groupes ORDER BY id',
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let orphelins = 0;
  for (const l of lignes) {
    const niveau = l.niveau_id === null ? null : (niveaux.get(l.niveau_id) ?? null);
    if (l.niveau_id !== null && !niveau) orphelins += 1;
    const { id, cree } = await reprendre(c, 'groups', ecole, l.id, {
      name: l.nom,
      level_id: niveau,
      capacity: l.capacite,
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (orphelins) decision(`${orphelins} groupe(s) pointaient un niveau absent — niveau laissé vide`);
  noter({ nom: 'groupes', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

async function importerMatieres(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  niveaux: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, nom, coefficient, niveau_id, note_sur FROM matieres ORDER BY id',
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const niveau = l.niveau_id === null ? null : (niveaux.get(l.niveau_id) ?? null);
    if (l.niveau_id !== null && !niveau) {
      // Sa clé unique est (nom, niveau_id) : rattacher au hasard fusionnerait
      // deux matières homonymes de niveaux différents, donc leurs notes.
      ecartees += 1;
      continue;
    }
    const { id, cree } = await reprendre(c, 'subjects', ecole, l.id, {
      name: l.nom,
      level_id: niveau,
      coefficient: l.coefficient,
      max_score: montant(l.note_sur, '20'),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} matière(s) pointaient un niveau absent — écartée(s)`);
  noter({ nom: 'matières', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

/**
 * LES CORRESPONDANTS — `parents` → `users`.
 *
 * ⚠ `users` EST GLOBALE ET N'A PAS DE `legacy_id`, et c'est délibéré : une
 * famille dont les enfants sont dans deux branches doit avoir UN compte, pas
 * deux (0001). La correspondance se fait donc sur le TÉLÉPHONE — unique des deux
 * côtés, et c'est l'identifiant avec lequel un parent se connecte chez lui.
 *
 * ⚠ ET ON NE PIÉTINE PAS UN COMPTE QUI N'EST PAS UN PARENT. Si le numéro
 * appartient déjà à quelqu'un qui porte un autre rôle — un secrétaire dont le
 * téléphone personnel figure aussi dans `parents` — écraser son nom et son
 * empreinte de mot de passe le déconnecterait de son propre poste. On le
 * signale, on garde le lien vers ses enfants, et on ne réécrit rien.
 *
 * ⚠ LES EMPREINTES DE MOT DE PASSE PASSENT TELLES QUELLES. 1 370 `$2y$` bcrypt
 * et 2 `$argon2id$` cohabitent ; la vérification accepte les deux et re-hache à
 * la connexion (règle 12). Forcer une réinitialisation bloquerait 1 372 familles
 * d'un coup. Elles ne sont évidemment jamais journalisées.
 */
async function importerCorrespondants(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, telephone, mot_de_passe, nom_complet, email, actif, doit_changer_mdp,
            derniere_connexion, tentatives_echec, bloque_jusqua, date_creation,
            nni, telephone2, nom_secondaire
       FROM parents ORDER BY id`,
  );

  const { rows: roles } = await c.query<{ id: string }>(
    "SELECT id FROM roles WHERE code = 'parent'",
  );
  const roleParent = roles[0]?.id;
  if (!roleParent) throw new Error('Le rôle « parent » n’existe pas. Lancez les migrations.');

  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let heurts = 0;
  const perdus = { nni: 0, telephone2: 0, nom_secondaire: 0 };

  for (const l of lignes) {
    const tel = String(l.telephone ?? '').trim();
    if (!tel) {
      ecartees += 1;
      continue;
    }
    if (l.nni) perdus.nni += 1;
    if (l.telephone2) perdus.telephone2 += 1;
    if (l.nom_secondaire) perdus.nom_secondaire += 1;

    const champs = {
      full_name: l.nom_complet || tel,
      password_hash: l.mot_de_passe,
      email: l.email || null,
      active: l.actif === null ? true : Boolean(l.actif),
      must_change_password: Boolean(l.doit_changer_mdp),
      failed_logins: l.tentatives_echec ?? 0,
      locked_until: horodatage(l.bloque_jusqua),
      last_login_at: horodatage(l.derniere_connexion),
    };
    const cols = Object.keys(champs);

    const { rows: connus } = await c.query<{ id: string; autres: number }>(
      `SELECT u.id,
              (SELECT COUNT(*)::int FROM user_school_roles usr
                 JOIN roles r ON r.id = usr.role_id
                WHERE usr.user_id = u.id AND r.code <> 'parent')
              + u.is_platform_admin::int AS autres
         FROM users u WHERE u.phone = $1`,
      [tel],
    );

    let userId: string;
    if (connus[0]) {
      userId = connus[0].id;
      if (connus[0].autres > 0) {
        heurts += 1;
        carte.set(l.id, userId);
        continue;
      }
      await c.query(
        `UPDATE users SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [userId, ...Object.values(champs)],
      );
      majs += 1;
    } else {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO users (phone, locale, created_at, ${cols.join(', ')})
         VALUES ($1, 'fr', $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
        [tel, horodatage(l.date_creation) ?? new Date().toISOString(), ...Object.values(champs)],
      );
      userId = rows[0]!.id;
      creees += 1;
    }

    // Le rattachement à la branche : c'est `user_school_roles`, pas `users`,
    // qui porte le lien à l'école.
    await c.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
      [userId, ecole, roleParent],
    );
    carte.set(l.id, userId);
  }

  if (heurts) {
    decision(
      `${heurts} numéro(s) appartenaient déjà à un compte non-parent — compte réutilisé, ` +
        'jamais réécrit',
    );
  }
  for (const [champ, n] of Object.entries(perdus)) {
    if (n) {
      decision(`parents.${champ} : ${n} valeur(s) sans destination dans « users » — non reprises`);
    }
  }
  noter({ nom: 'correspondants', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

async function importerEleves(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  correspondants: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, rim, nni, identifiant, nom, prenom, sexe, date_naissance, lieu_naissance, parent_id, sorti,
            date_inscription
       FROM etudiants ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let sansCorrespondant = 0;
  for (const l of lignes) {
    const tuteur = l.parent_id === null ? null : (correspondants.get(l.parent_id) ?? null);
    if (l.parent_id !== null && !tuteur) sansCorrespondant += 1;
    const { id, cree } = await reprendre(c, 'students', ecole, l.id, {
      guardian_id: tuteur,
      rim: l.rim,
      national_id: l.nni,
      // Son matricule interne « ETyy##### » (0036), distinct du RIM et du NNI.
      matricule: l.identifiant || null,
      first_name: l.prenom,
      last_name: l.nom,
      sex: l.sexe,
      date_of_birth: jour(l.date_naissance),
      // ⚠ `lieu_naissance` VA DANS `place_of_birth`, PAS DANS `address`.
      // « Arafat », « Ksar », « Toujounine » sont des moughataas de Nouakchott —
      // et « Guerou » est en Assaba, à 300 km : cohérent comme lieu de
      // naissance, impossible comme adresse d'un enfant scolarisé ici. C'est
      // exactement l'erreur que corrige la migration 0018.
      place_of_birth: l.lieu_naissance || null,
      has_left: Boolean(l.sorti),
    }, {
      // Son « Inscrit le » (`gestion_groupes.php`) : la date de création de la fiche.
      created_at: l.date_inscription ?? new Date(),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (sansCorrespondant) {
    decision(`${sansCorrespondant} élève(s) pointaient un parent absent — tuteur laissé vide`);
  }
  decision(
    'etudiants.frais_mensuel / groupe_id / derniere_annee / nom_parent / telephone_parent : ' +
      'copies dénormalisées, remplacées par l’inscription de l’année et par « users »',
  );
  noter({ nom: 'élèves', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

/**
 * LES INSCRIPTIONS — une par élève et par année.
 *
 * ⚠ `tarif_plein` EST REPRIS TEL QUEL, MÊME À ZÉRO. 291 lignes le portent à
 * zéro, et ce sont EXACTEMENT les 291 inscriptions annulées : une inscription
 * annulée n'a pas de barème, ce qui est cohérent et non un défaut. Le remplacer
 * par le tarif du niveau inventerait un montant qu'El Ourwa n'a jamais réclamé
 * (règles 24 et 26).
 *
 * `reduction_mensuelle` n'est pas reprise : elle vaut `tarif_plein − frais_mensuel`
 * et se déduit donc de `full_rate` et `monthly_fee`. ⚠ Elle n'est jamais négative
 * chez lui — il la borne à zéro sur les 59 lignes où la soustraction le serait —
 * et le calcul d'affichage doit reproduire cette borne, sans quoi une facture
 * annoncerait une « réduction » négative.
 */
async function importerInscriptions(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  annees: Carte,
  groupes: Carte,
  niveaux: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, etudiant_id, annee_id, groupe_id, niveau_id, statut, frais_mensuel,
            gratuit, frais_inscription, frais_document, frais_fourniture,
            tarif_plein, decision, date_entree
       FROM etudiant_inscriptions ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let sansNiveau = 0;
  let sansGroupe = 0;
  for (const l of lignes) {
    const eleve = eleves.get(l.etudiant_id);
    const annee = l.annee_id === null ? undefined : annees.get(l.annee_id);
    if (!eleve || !annee) {
      // Sans élève ni année la ligne ne veut rien dire, et ses deux colonnes
      // obligatoires ne peuvent pas être devinées.
      ecartees += 1;
      continue;
    }
    const groupe = l.groupe_id === null ? null : (groupes.get(l.groupe_id) ?? null);
    const niveau = l.niveau_id === null ? null : (niveaux.get(l.niveau_id) ?? null);
    if (!groupe) sansGroupe += 1;
    if (!niveau) sansNiveau += 1;

    const { id, cree } = await reprendre(c, 'enrollments', ecole, l.id, {
      student_id: eleve,
      academic_year_id: annee,
      group_id: groupe,
      level_id: niveau,
      status: STATUT[l.statut] ?? 'archived',
      monthly_fee: montant(l.frais_mensuel),
      full_rate: montant(l.tarif_plein),
      enrolment_fee: montant(l.frais_inscription),
      document_fee: montant(l.frais_document),
      supplies_fee: montant(l.frais_fourniture),
      is_free: Boolean(l.gratuit),
      outcome: DECISION[l.decision] ?? 'pending',
      entry_date: jour(l.date_entree),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} inscription(s) sans élève ou sans année — écartée(s)`);
  if (sansGroupe) decision(`${sansGroupe} inscription(s) sans groupe — groupe laissé vide`);
  if (sansNiveau) decision(`${sansNiveau} inscription(s) sans niveau — niveau laissé vide`);
  // ⚠ LE SEUL VRAI TROU DE LA REPRISE, ET IL EST CHIFFRÉ.
  //
  // El Ourwa suit les frais annuels PAR INSCRIPTION — `inscription_payee`,
  // `document_paye`, `exempte_inscription`… — alors que notre modèle les suit PAR
  // FAMILLE : un aîné qui a payé solde la fratrie (`family_fee_payments`).
  //
  // Traduire l'un dans l'autre changerait ce que l'école réclame, dans les deux
  // sens. Un enfant exempté deviendrait une famille exemptée, donc moins d'argent
  // dû ; et fabriquer un paiement pour « inscription_payee » inventerait un
  // montant et un numéro de reçu qui n'ont jamais existé (règle 24). C'est une
  // décision sur de l'argent : elle se pose, elle ne se prend pas ici (règle 16).
  const [drapeaux] = await my.query<mysql.RowDataPacket[]>(
    `SELECT SUM(exempte_inscription) ei, SUM(exempte_document) ed,
            SUM(exempte_fourniture) ef, SUM(inscription_payee) ip, SUM(document_paye) dp
       FROM etudiant_inscriptions`,
  );
  const d = drapeaux[0]!;
  decision(
    '⚠ frais annuels suivis PAR INSCRIPTION chez lui, PAR FAMILLE ici — non repris : ' +
      `${d.ei} exempté(e)s d'inscription, ${d.ed} de document, ${d.ef} de fourniture, ` +
      `${d.ip} inscriptions et ${d.dp} documents marqués payés. Traduire changerait ce que ` +
      'l’école réclame (ADR-0057)',
  );
  noter({ nom: 'inscriptions', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

/**
 * LA FORMULE DU BULLETIN — `bulletin_formules` → `bulletin_formulas`.
 *
 * ⚠ SES SOIXANTE LIGNES PORTENT TOUTES d=0, e=1, q=1 — l'examen seul. C'est la
 * règle historique de l'école, et c'est elle qui explique ADR-0054 : sur ces
 * niveaux, un marqueur d'absence en examen devient « −1.00 » sur le bulletin,
 * parce qu'il n'y a rien d'autre à moyenner.
 *
 * ⚠ ET `mode_calcul` N'A AUCUNE DESTINATION PARCE QU'IL N'A AUCUN LECTEUR.
 * `grep -rn mode_calcul` sur tout `reference/v16/src` ne trouve rien : la colonne
 * est déclarée, remplie — 60 fois `examen_seul` — et jamais lue. Les
 * coefficients se décrivent eux-mêmes : d=0 et e=1 DIT « examen seul ». Importer
 * une redondance que personne ne lit serait importer une occasion de divergence.
 */
async function importerFormules(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  niveaux: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, niveau_id, trimestre, coef_devoirs, coef_examen, diviseur FROM bulletin_formules',
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const niveau = niveaux.get(l.niveau_id);
    if (!niveau) {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'bulletin_formulas', ecole, l.id, {
      level_id: niveau,
      term: l.trimestre,
      coursework_weight: montant(l.coef_devoirs, '2'),
      exam_weight: montant(l.coef_examen, '3'),
      divisor: montant(l.diviseur, '5'),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} formule(s) pointaient un niveau absent — écartée(s)`);
  decision(
    'bulletin_formules.mode_calcul : non reprise — aucun lecteur dans tout le source ' +
      'd’El Ourwa, et d=0 / e=1 dit déjà « examen seul »',
  );
  noter({ nom: 'formules', lues: lignes.length, creees, majs, ecartees });
}

/**
 * LE PERSONNEL — `utilisateurs` → `users` + `user_school_roles`.
 *
 * ⚠ SON IDENTIFIANT DE CONNEXION N'EST PAS UNE ADRESSE, ET IL A SA COLONNE.
 * Trois des quatre comptes se connectent avec `e.historique`, `s.employ339`,
 * `parite_lab` ; un seul avec `admin@supnum.mr`. La migration 0027 a ajouté
 * `users.username` pour cela, et la connexion accepte désormais les trois formes.
 *
 * L'identifiant part donc dans `username`, et dans `email` **seulement quand
 * c'en est une**. Mettre `e.historique` dans `email` ferait qu'un écran de profil
 * l'annoncerait comme une adresse électronique, et qu'un envoi de courrier
 * viserait une boîte qui n'existe pas.
 *
 * ⚠ `users` EST GLOBALE ET N'A PAS DE `legacy_id` : une personne présente dans
 * deux branches doit avoir UN compte (0001). Le rapprochement se fait donc sur
 * l'identifiant lui-même, unique des deux côtés.
 *
 * ⚠ ET ON NE PIÉTINE PAS LE COMPTE DE QUELQU'UN D'AUTRE. Si l'identifiant
 * appartient déjà à un correspondant, écraser son nom et son empreinte de mot de
 * passe le déconnecterait. On le signale et on n'y touche pas.
 *
 * ⚠ LES EMPREINTES DE MOT DE PASSE PASSENT TELLES QUELLES. La vérification
 * accepte Argon2id et bcrypt et re-hache à la connexion (règle 12).
 *
 * Les rôles viennent de `utilisateur_roles`, la table normalisée, avec repli sur
 * l'ancienne colonne `utilisateurs.role` : ses six codes sont identiques aux
 * nôtres, ce qui n'est pas un hasard — les nôtres en viennent.
 */
async function importerPersonnel(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT u.id, u.identifiant, u.mot_de_passe, u.role, u.nom, u.prenom, u.actif,
            u.derniere_connexion, u.tentatives_echec, u.bloque_jusqua, u.date_creation,
            COALESCE(
              (SELECT GROUP_CONCAT(r.code) FROM utilisateur_roles ur
                 JOIN roles r ON r.id = ur.role_id
                WHERE ur.utilisateur_id = u.id),
              u.role
            ) AS codes
       FROM utilisateurs u ORDER BY u.id`,
  );

  const { rows: tousRoles } = await c.query<{ id: string; code: string }>(
    'SELECT id, code FROM roles',
  );
  const parCode = new Map(tousRoles.map((r) => [r.code, r.id]));

  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let heurts = 0;
  let pasUneAdresse = 0;
  const inconnus = new Set<string>();

  for (const l of lignes) {
    const identifiant = String(l.identifiant ?? '').trim();
    if (!identifiant) {
      ecartees += 1;
      continue;
    }
    // Une adresse est une adresse ; tout le reste est un nom d'utilisateur.
    const estUneAdresse = identifiant.includes('@');
    if (!estUneAdresse) pasUneAdresse += 1;

    const champs = {
      username: identifiant,
      email: estUneAdresse ? identifiant : null,
      full_name: [l.prenom, l.nom].filter(Boolean).join(' ') || identifiant,
      password_hash: l.mot_de_passe,
      active: l.actif === null ? true : Boolean(l.actif),
      failed_logins: l.tentatives_echec ?? 0,
      locked_until: horodatage(l.bloque_jusqua),
      last_login_at: horodatage(l.derniere_connexion),
    };
    const cols = Object.keys(champs);

    // ⚠ Le même garde-fou que pour les correspondants : si l'identifiant
    // appartient déjà à un correspondant, on ne réécrit ni son nom ni son
    // empreinte de mot de passe.
    const { rows: connus } = await c.query<{ id: string; parent: boolean }>(
      `SELECT u.id,
              EXISTS (SELECT 1 FROM user_school_roles usr
                        JOIN roles r ON r.id = usr.role_id
                       WHERE usr.user_id = u.id AND r.code = 'parent') AS parent
         FROM users u
        WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)`,
      [identifiant],
    );

    let userId: string;
    if (connus[0]) {
      userId = connus[0].id;
      if (connus[0].parent) {
        heurts += 1;
        carte.set(l.id, userId);
        continue;
      }
      await c.query(
        `UPDATE users SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [userId, ...Object.values(champs)],
      );
      majs += 1;
    } else {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO users (locale, created_at, ${cols.join(', ')})
         VALUES ('fr', $1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [horodatage(l.date_creation) ?? new Date().toISOString(), ...Object.values(champs)],
      );
      userId = rows[0]!.id;
      creees += 1;
    }

    for (const code of String(l.codes ?? '')
      .split(',')
      .filter(Boolean)) {
      const roleId = parCode.get(code);
      if (!roleId) {
        inconnus.add(code);
        continue;
      }
      await c.query(
        `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
        [userId, ecole, roleId],
      );
    }
    carte.set(l.id, userId);
  }

  if (pasUneAdresse) {
    decision(
      `${pasUneAdresse} identifiant(s) de connexion ne sont pas des adresses — rangé(s) dans ` +
        '« username », et « email » laissé vide (migration 0027, ADR-0056)',
    );
  }
  if (heurts) decision(`${heurts} identifiant(s) appartenaient à un correspondant — non réécrits`);
  if (inconnus.size) decision(`rôle(s) inconnu(s) ici, ignoré(s) : ${[...inconnus].join(', ')}`);
  noter({ nom: 'personnel', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

async function importerProfesseurs(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  personnel: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, utilisateur_id, nom, prenom, situation, sexe, telephone,
            prix_par_heure, salaire
       FROM professeurs ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let sansCompte = 0;
  for (const l of lignes) {
    const compte = personnel.get(l.utilisateur_id) ?? null;
    if (!compte) sansCompte += 1;
    const { id, cree } = await reprendre(c, 'teachers', ecole, l.id, {
      user_id: compte,
      first_name: l.prenom || '',
      last_name: l.nom || '',
      sex: l.sexe,
      phone: l.telephone || null,
      employment: l.situation,
      hourly_rate: montant(l.prix_par_heure),
      salary: montant(l.salaire),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (sansCompte) {
    decision(`${sansCompte} professeur(s) sans compte correspondant — compte laissé vide`);
  }
  decision(
    'professeurs.nb_classes / heures_par_mois : compteurs dérivés des enseignements — ' +
      'non repris, ils se recalculent',
  );
  noter({ nom: 'professeurs', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

/**
 * LES ENSEIGNEMENTS — professeur × groupe × matière × année.
 *
 * ⚠ `enseignements.prix_par_heure` N'EST PAS REPRIS, ET IL LE FAUDRA UN JOUR. Il
 * porte un tarif horaire propre à CET enseignement, qui prime sur celui du
 * professeur ; notre `teachings` n'a pas la colonne. Aucune ligne ne le
 * renseigne aujourd'hui, donc rien n'est perdu — mais la paie le lira le jour où
 * quelqu'un le remplira. Compté à chaque passage plutôt qu'oublié.
 */
async function importerEnseignements(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  professeurs: Carte,
  groupes: Carte,
  matieres: Carte,
  annees: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, professeur_id, groupe_id, matiere_id, annee_id, heures_par_semaine,
            prix_par_heure
       FROM enseignements ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let tarifPropre = 0;
  for (const l of lignes) {
    const prof = professeurs.get(l.professeur_id);
    const groupe = groupes.get(l.groupe_id);
    const matiere = matieres.get(l.matiere_id);
    const annee = l.annee_id === null ? undefined : annees.get(l.annee_id);
    // Les quatre sont obligatoires chez nous, et il n'y a rien à deviner.
    if (!prof || !groupe || !matiere || !annee) {
      ecartees += 1;
      continue;
    }
    if (l.prix_par_heure !== null) tarifPropre += 1;
    const { id, cree } = await reprendre(c, 'teachings', ecole, l.id, {
      academic_year_id: annee,
      teacher_id: prof,
      group_id: groupe,
      subject_id: matiere,
      hours_per_week: montant(l.heures_par_semaine),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} enseignement(s) incomplet(s) — écarté(s)`);
  if (tarifPropre) {
    decision(
      `⚠ ${tarifPropre} enseignement(s) portent un prix_par_heure propre, sans colonne ici ` +
        '— la paie les ignorerait (ADR-0056)',
    );
  }
  noter({ nom: 'enseignements', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

/**
 * LES NOTES — 139 457 lignes, et la seule étape qui ne peut pas être écrite ligne
 * à ligne.
 *
 * ⚠ `reprendre()` fait un SELECT puis un INSERT ou un UPDATE : ce serait 280 000
 * allers-retours, des minutes d'attente pour une reprise qu'on doit pouvoir
 * relancer sans y penser. Ici l'écriture passe par `unnest`, mille lignes à la
 * fois, avec `ON CONFLICT` sur la clé naturelle — qui EST l'identité d'une note :
 * élève, enseignement, trimestre, nature, numéro. Une note ne se « renomme » pas.
 *
 * ⚠ LE MARQUEUR D'ABSENCE PASSE TEL QUEL. 1 580 lignes portent `valeur = -1`, et
 * c'est un MARQUEUR, pas une note (règle 11). Le filtrer à l'import perdrait
 * l'information « absent » ; c'est le CALCUL qui doit l'exclure, et
 * `@elourwa/shared` le fait. La réconciliation des bulletins mesure exactement
 * cet écart avec El Ourwa, qui lui le moyenne (ADR-0054).
 *
 * ⚠ ET LA REPRISE N'EST PAS UN MIROIR. Une note supprimée chez lui ne disparaît
 * pas ici à la relance ; c'est le décompte de la réconciliation qui le dirait. Un
 * import qui supprimerait des lignes serait bien plus dangereux qu'un import qui
 * en laisse.
 */
async function importerNotes(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  enseignements: Carte,
  annees: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, etudiant_id, enseignement_id, annee_id, valeur, trimestre, type_note,
            numero_devoir, date_saisie
       FROM notes ORDER BY id`,
  );

  const PAQUET = 1000;
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let marqueurs = 0;

  interface Ligne {
    eleve: string;
    ens: string;
    annee: string;
    term: number;
    kind: string;
    seq: number;
    score: string;
    legacy: number;
    le: string | null;
  }
  let lot: Ligne[] = [];

  const vider = async () => {
    if (!lot.length) return;
    const { rows } = await c.query<{ cree: boolean }>(
      `INSERT INTO grades (school_id, student_id, teaching_id, academic_year_id, term,
                           kind, sequence_no, score, legacy_id, recorded_at, origin)
       SELECT $1, e.eleve, e.ens, e.annee, e.term, e.kind::grade_kind, e.seq, e.score,
              e.legacy, COALESCE(e.le, now()), 'migrated'
         FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::smallint[], $6::text[],
                     $7::smallint[], $8::numeric[], $9::integer[], $10::timestamptz[])
              AS e(eleve, ens, annee, term, kind, seq, score, legacy, le)
       ON CONFLICT (school_id, student_id, teaching_id, term, kind, sequence_no)
       DO UPDATE SET score = EXCLUDED.score, legacy_id = EXCLUDED.legacy_id,
                     recorded_at = EXCLUDED.recorded_at
       RETURNING (xmax = 0) AS cree`,
      [
        ecole,
        lot.map((x) => x.eleve),
        lot.map((x) => x.ens),
        lot.map((x) => x.annee),
        lot.map((x) => x.term),
        lot.map((x) => x.kind),
        lot.map((x) => x.seq),
        lot.map((x) => x.score),
        lot.map((x) => x.legacy),
        lot.map((x) => x.le),
      ],
    );
    // ⚠ Compter le paquet entier comme « créé » annonçait 139 457 créations à
    // chaque relance, alors que rien n'était créé. Un journal qui ment sur ce
    // qu'il a fait ne sert plus à repérer ce qui a changé. `xmax = 0` distingue
    // réellement l'insérée de la mise à jour, ligne par ligne.
    for (const r of rows) {
      if (r.cree) creees += 1;
      else majs += 1;
    }
    lot = [];
  };

  for (const l of lignes) {
    const eleve = eleves.get(l.etudiant_id);
    const ens = enseignements.get(l.enseignement_id);
    const annee = l.annee_id === null ? undefined : annees.get(l.annee_id);
    if (!eleve || !ens || !annee) {
      ecartees += 1;
      continue;
    }
    const score = montant(l.valeur);
    if (score.startsWith('-1')) marqueurs += 1;
    lot.push({
      eleve,
      ens,
      annee,
      term: l.trimestre,
      kind: l.type_note === 'examen' ? 'exam' : 'coursework',
      seq: l.numero_devoir,
      score,
      legacy: l.id,
      le: horodatage(l.date_saisie),
    });
    if (lot.length >= PAQUET) await vider();
  }
  await vider();

  if (ecartees) decision(`${ecartees} note(s) sans élève, enseignement ou année — écartée(s)`);
  decision(
    `${marqueurs} note(s) portent le marqueur d’absence (-1) — reprises telles quelles : ` +
      'c’est le calcul qui l’exclut, pas l’import (règle 11)',
  );
  noter({ nom: 'notes', lues: lignes.length, creees, majs, ecartees });
}

void principal().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`);
  process.exit(1);
});
