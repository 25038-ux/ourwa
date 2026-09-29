import type mysql from 'mysql2/promise';
import type pg from 'pg';
import {
  decision,
  horodatage,
  jour,
  moisAutoExempte,
  montant,
  noter,
  reprendre,
  type Carte,
} from './commun.js';

/**
 * LA TRANCHE FINANCIÈRE — moyens de paiement, encaissements, échéanciers,
 * dépenses, exemptions, réductions, remises de dette et frais annuels.
 *
 * ⚠ C'EST LA TRANCHE QUI COMPTE. Tout le reste décrit l'école ; celle-ci dit ce
 * que 1 372 familles ont payé et ce qu'elles doivent encore. Un écart d'un
 * centime ici est un défaut bloquant (règle 25), pas une curiosité d'arrondi —
 * et `checks/finance.ts` le mesure des deux côtés avant qu'on aille plus loin.
 *
 * ## ⚠ `origine` N'EST PAS « d'où vient la ligne pour NOUS »
 *
 * `paiements.origine` vaut `reprise`, `elourwa` ou `impute`, et
 * `ARCHITECTURE.md` §6 le porte tel quel dans `record_origin` :
 *
 * | El Ourwa | ici | ce que ça veut dire |
 * |---|---|---|
 * | `reprise` | `migrated` | hérité du logiciel qui précédait El Ourwa |
 * | `elourwa` | `native` | saisi à la main dans El Ourwa |
 * | `impute` | `imputed` | reconstitué depuis un encaissement global |
 *
 * Tout ramener à `migrated` sous prétexte que ça nous arrive par un import
 * effacerait la distinction sur laquelle les rapports financiers s'appuient —
 * 17 106 lignes en dépendent, et `CLAUDE.md` dit de ne jamais la laisser tomber.
 * Un encaissement **imputé** n'est pas un encaissement constaté : quelqu'un a
 * réparti une somme globale, et le jour où un parent conteste, la différence est
 * toute la conversation.
 */

/** `record_origin`, en gardant le sens et pas la provenance. */
const ORIGINE: Record<string, string> = {
  reprise: 'migrated',
  elourwa: 'native',
  impute: 'imputed',
};

const MOIS_STATUT: Record<string, string> = {
  a_facturer: 'billable',
  facture: 'invoiced',
  gratuit: 'free',
};

export async function importerFinance(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  annees: Carte,
  inscriptions: Carte,
  correspondants: Carte,
  personnel: Carte,
) {
  const moyens = await importerMoyens(my, c, ecole);
  await importerMoisEcheancier(my, c, ecole, inscriptions, annees);
  const paiements = await importerPaiements(my, c, ecole, eleves, annees, personnel);
  await importerLignes(my, c, ecole, paiements, moyens);
  await importerDepenses(my, c, ecole, personnel);
  await importerExemptions(my, c, ecole, eleves, personnel);
  await importerReductions(my, c, ecole, eleves, personnel);
  await importerRemises(my, c, ecole, correspondants, annees, personnel);
  await importerFraisAnnuels(my, c, ecole, correspondants, annees, personnel);
  await importerArchives(my, c, ecole, correspondants);
}

/**
 * LES ARCHIVES DE L'ANCIEN LOGICIEL — `recus` et `compta_lignes` (compte 560011).
 *
 * ⚠ CE N'EST PAS DE LA CAISSE D'EL OURWA, ET IL LES LIT QUAND MÊME. Sa
 * « Synthèse — Année scolaire » (`bilan_annee_scolaire()`) prend, pour une
 * année reprise, le total des REÇUS d'origine comme chiffre d'encaissement —
 * « le seul qui reflète tout l'argent entré » — et le débit du compte 560011
 * comme dépense d'archive. Sans ces deux tables, la synthèse de 2024-2025 et
 * de 2025-2026 ne dirait pas ce qu'elle dit chez lui.
 *
 * Reprises telles quelles, jamais écrites par l'application. Seul le compte
 * 560011 de `compta_lignes` est repris : c'est le seul qu'il lise.
 */
async function importerArchives(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  correspondants: Carte,
) {
  const [recus] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, numero, libelle, parent_id, montant_paye, montant_restant, total_facture,
            date_recu, origine
       FROM recus ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  for (const r of recus) {
    const { cree } = await reprendre(c, 'legacy_receipts', ecole, r.id, {
      numero: r.numero ?? null,
      libelle: r.libelle ?? null,
      guardian_id: correspondants.get(r.parent_id) ?? null,
      amount_paid: montant(r.montant_paye),
      amount_remaining: montant(r.montant_restant),
      invoice_total: montant(r.total_facture),
      received_at: horodatage(r.date_recu),
      origin: ORIGINE[r.origine] ?? 'migrated',
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'reçus (archive)', lues: recus.length, creees, majs, ecartees: 0 });

  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, date_piece, numero_piece, journal, compte, libelle, debit, credit, tiers_nom, origine
       FROM compta_lignes WHERE compte = '560011' ORDER BY id`,
  );
  creees = 0;
  majs = 0;
  for (const l of lignes) {
    const { cree } = await reprendre(c, 'legacy_ledger_lines', ecole, l.id, {
      piece_date: jour(l.date_piece),
      piece_no: l.numero_piece ?? null,
      journal: l.journal ?? null,
      account: l.compte,
      label: l.libelle ?? null,
      debit: montant(l.debit),
      credit: montant(l.credit),
      third_party: l.tiers_nom ?? null,
      origin: ORIGINE[l.origine] ?? 'migrated',
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'caisse 560011 (archive)', lues: lignes.length, creees, majs, ecartees: 0 });
}

async function importerMoyens(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, nom, actif FROM moyens_paiement ORDER BY id',
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  for (const l of lignes) {
    const { id, cree } = await reprendre(c, 'payment_methods', ecole, l.id, {
      name: l.nom,
      is_active: Boolean(l.actif),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'moyens', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

/**
 * L'ÉCHÉANCIER — `inscription_mois` → `enrollment_months`.
 *
 * ⚠ SON `mois_ordre` EST UN RANG, PAS UN MOIS. Il vaut 1 à 9 et signifie « le
 * premier mois de l'année scolaire », pas « janvier ». Notre table stocke le
 * mois civil et son année, parce qu'un paiement se rattache à un mois civil.
 *
 * La conversion NE PEUT PAS être une simple addition sur le mois de début. Une
 * année qui saute un mois — Ramadan, une ouverture tardive après des travaux —
 * a un rang 4 qui n'est pas « début + 3 ». On reconstruit donc la LISTE ORDONNÉE
 * des mois réellement facturés de l'année (migration 0016), et le rang y est un
 * index. Là où aucun mois n'est coché, la liste retombe sur l'étendue
 * `start_month..end_month`, ce qui est exactement ce que dit cette migration.
 *
 * ⚠ Se tromper d'un rang décale tout l'échéancier d'une famille d'un mois, et
 * chaque paiement se retrouverait imputé au mois voisin.
 */
async function importerMoisEcheancier(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  inscriptions: Carte,
  annees: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT im.id, im.inscription_id, im.mois_ordre, im.mois_libelle, im.statut,
            im.montant_du, im.couvert_facture, im.reliquat,
            ei.annee AS annee_scolaire, e.date_inscription
       FROM inscription_mois im
       JOIN etudiant_inscriptions ei ON ei.id = im.inscription_id
       JOIN etudiants e ON e.id = ei.etudiant_id
      ORDER BY im.id`,
  );

  // La liste ordonnée des mois civils de chaque année scolaire.
  const { rows: cal } = await c.query<{
    annee: string;
    start_year: number;
    start_month: number;
    end_month: number;
    mois: number[] | null;
  }>(
    `SELECT y.id AS annee, y.start_year, y.start_month, y.end_month,
            (SELECT array_agg(m.calendar_month ORDER BY
                     CASE WHEN m.calendar_month >= y.start_month THEN 0 ELSE 1 END,
                     m.calendar_month)
               FROM academic_year_months m
              WHERE m.school_id = y.school_id AND m.academic_year_id = y.id) AS mois
       FROM academic_years y WHERE y.school_id = $1`,
    [ecole],
  );

  const calendrier = new Map<string, { mois: number; an: number }[]>();
  const bornes = new Map<string, { debut: number; fin: number }>();
  for (const y of cal) {
    bornes.set(y.annee, { debut: y.start_month, fin: y.end_month });
    let suite = y.mois;
    if (!suite || suite.length === 0) {
      // Vide veut dire l'étendue, pas « aucun mois » (migration 0016).
      suite = [];
      for (let m = y.start_month; ; m = (m % 12) + 1) {
        suite.push(m);
        if (m === y.end_month) break;
      }
    }
    calendrier.set(
      y.annee,
      suite.map((m) => ({ mois: m, an: m >= y.start_month ? y.start_year : y.start_year + 1 })),
    );
  }

  // De quelle année scolaire relève chaque inscription.
  const { rows: liens } = await c.query<{ id: string; annee: string }>(
    'SELECT id, academic_year_id AS annee FROM enrollments WHERE school_id = $1',
    [ecole],
  );
  const anneeDe = new Map(liens.map((r) => [r.id, r.annee]));

  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let horsListe = 0;
  let reliquats = 0;
  let autoExemptes = 0;
  for (const l of lignes) {
    const inscription = inscriptions.get(l.inscription_id);
    const annee = inscription ? anneeDe.get(inscription) : undefined;
    const suite = annee ? calendrier.get(annee) : undefined;
    const civil = suite?.[Number(l.mois_ordre) - 1];
    if (!inscription || !civil) {
      // `calendar_month` et `calendar_year` sont obligatoires ; les deviner
      // rattacherait des mois payés au mauvais mois.
      if (inscription && !civil) horsListe += 1;
      ecartees += 1;
      continue;
    }
    if (montant(l.reliquat) !== '0.00') reliquats += 1;

    // ⚠ SA RÈGLE DE CALCUL DEVIENT NOTRE ÉTAT : un mois d'avant l'entrée de
    // l'élève est `free`, comme notre constructeur d'échéancier l'aurait écrit.
    // Seul un mois encore à facturer se traduit ; un mois facturé ou gratuit
    // reste ce qu'il est.
    let status = MOIS_STATUT[l.statut] ?? 'billable';
    const b = bornes.get(annee!)!;
    if (
      status === 'billable' &&
      moisAutoExempte(l.date_inscription, Number(l.annee_scolaire), civil.mois, civil.an, b.debut, b.fin)
    ) {
      status = 'free';
      autoExemptes += 1;
    }

    const { cree } = await reprendre(c, 'enrollment_months', ecole, l.id, {
      enrollment_id: inscription,
      month_order: l.mois_ordre,
      month_label: l.mois_libelle || null,
      calendar_month: civil.mois,
      calendar_year: civil.an,
      status,
      amount_due: montant(l.montant_du),
      covered_by_invoice: Boolean(l.couvert_facture),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (horsListe) {
    decision(`⚠ ${horsListe} mois d’échéancier ont un rang hors de la liste de leur année`);
  }
  decision(
    `${autoExemptes} mois d’avant l’entrée de l’élève écrits « free » — sa règle de calcul ` +
      '(`mois_auto_exempte_infos`) traduite en état, comme notre échéancier l’écrit (ADR-0057)',
  );
  if (ecartees) decision(`${ecartees} mois d’échéancier sans inscription ou sans rang — écarté(s)`);
  if (reliquats) {
    decision(
      `inscription_mois.reliquat : ${reliquats} règlement(s) partiel(s) sans colonne ici — ` +
        'le montant reste dans `amount_due`',
    );
  }
  decision(
    'inscription_mois.facture_source : la facture de l’ancien logiciel n’a pas de reprise ' +
      '(ADR-0010) ; `covered_by_invoice` en garde le fait',
  );
  noter({ nom: 'échéancier', lues: lignes.length, creees, majs, ecartees });
}

/**
 * LES ENCAISSEMENTS.
 *
 * ⚠ SON `recu_numero` EST LIBRE, LE NÔTRE EST STRUCTURÉ. Chez lui c'est le numéro
 * du carnet à souches, écrit à la main ; chez nous `receipt_number` est
 * `PREFIXE-ANNEE-NNNNN`, unique par école, et `paper_reference` est justement le
 * champ prévu pour le numéro du carnet.
 *
 * On reprend donc le sien dans les DEUX : dans `receipt_number` parce qu'il est
 * unique et qu'il faut bien que la ligne en ait un, et dans `paper_reference`
 * parce que c'est ce que le parent a entre les mains. Fabriquer un nouveau
 * numéro rendrait tout reçu déjà remis introuvable.
 *
 * ⚠ ET ON NE TOUCHE PAS À `receipt_sequences`. La séquence sert aux encaissements
 * à venir ; la remplir avec des numéros hérités ferait qu'un futur reçu
 * ressemblerait à un ancien.
 */
async function importerPaiements(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  annees: Carte,
  personnel: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, etudiant_id, annee_id, mois, annee, montant, date_paiement,
            enregistre_par, recu_numero, origine
       FROM paiements ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let impute = 0;
  for (const l of lignes) {
    const eleve = eleves.get(l.etudiant_id);
    const annee = l.annee_id === null ? undefined : annees.get(l.annee_id);
    if (!eleve || !annee) {
      ecartees += 1;
      continue;
    }
    if (l.origine === 'impute') impute += 1;
    const { id, cree } = await reprendre(
      c,
      'payments',
      ecole,
      l.id,
      {
        student_id: eleve,
        academic_year_id: annee,
        calendar_month: l.mois,
        calendar_year: l.annee,
        amount: montant(l.montant),
        receipt_number: l.recu_numero,
        paper_reference: l.recu_numero,
        recorded_by: personnel.get(l.enregistre_par) ?? null,
        paid_at: horodatage(l.date_paiement),
        origin: ORIGINE[l.origine] ?? 'migrated',
      },
    );
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} encaissement(s) sans élève ou sans année — écarté(s)`);
  decision(
    `${impute} encaissement(s) marqués « imputé » — reconstitués depuis un encaissement ` +
      'global, et gardés comme tels : un montant imputé n’est pas un montant constaté',
  );
  decision(
    'paiements.montant_impute : la PART imputée n’a pas de colonne ici ; seul le fait l’est, ' +
      'par `origin = imputed`',
  );
  noter({ nom: 'encaissements', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

/**
 * LA VENTILATION PAR MOYEN DE PAIEMENT — `paiement_lignes` → `tender_lines`.
 *
 * ⚠ LA TABLE EST POLYMORPHE DES DEUX CÔTÉS, ET C'EST DÉLIBÉRÉ. Son `source_type`
 * vaut `paiement`, `pret_personnel`, `depense`, `salaire_prof`… : la même table
 * ventile un encaissement de scolarité, un remboursement de prêt et une dépense.
 * La migration 0014 a gardé cette forme mot pour mot — « une clé étrangère par
 * source, ce serait onze colonnes nullables et une contrainte que personne ne
 * tient à jour » — et **les mêmes chaînes de `source_type`**.
 *
 * On ne reprend donc ici que ce dont la source existe déjà : `paiement`. Le
 * reste — prêts, salaires — viendra avec sa propre tranche, et pointera les
 * mêmes lignes. Les compter à part évite de croire à une perte.
 */
async function importerLignes(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  paiements: Carte,
  moyens: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, source_type, source_id, moyen_id, montant, sens, date_creation
       FROM paiement_lignes ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  const differees = new Map<string, number>();
  for (const l of lignes) {
    if (l.source_type !== 'paiement') {
      differees.set(l.source_type, (differees.get(l.source_type) ?? 0) + 1);
      continue;
    }
    const paiement = paiements.get(l.source_id);
    const moyen = moyens.get(l.moyen_id);
    if (!paiement || !moyen) {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(
      c,
      'tender_lines',
      ecole,
      l.id,
      {
        // ⚠ Sa chaîne, telle quelle : c'est elle que lisent les rapports de caisse.
        source_type: 'paiement',
        source_id: paiement,
        payment_method_id: moyen,
        amount: montant(l.montant),
        direction: l.sens === 'sortant' ? 'out' : 'in',
        // ⚠ SA DATE, PAS CELLE DE LA REPRISE. Les 16 008 lignes reprises portaient
        // le jour de l'import : chaque rapport de caisse (jour, mois, année —
        // `revenue_live`, `rapport_financier`, la console) attribuait alors
        // 42,6 M MRU de deux années au jour de la reprise. `date_creation` est
        // le jour de son paiement pour chacune d'elles (vérifié : 16 008 / 16 008).
        created_at: horodatage(l.date_creation) ?? new Date().toISOString(),
      },
    );
    if (cree) creees += 1;
    else majs += 1;
  }
  for (const [type, n] of differees) {
    decision(
      `${n} ligne(s) de ventilation portent sur « ${type} » — elles viendront avec la ` +
        'tranche correspondante, elles ne sont pas perdues',
    );
  }
  if (ecartees) decision(`${ecartees} ligne(s) de ventilation orphelines — écartée(s)`);
  noter({ nom: 'ventilation', lues: lignes.length, creees, majs, ecartees });
}

async function importerDepenses(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  personnel: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, montant, description, date_depense, cree_par, statut, origine
       FROM depenses ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let enAttente = 0;
  for (const l of lignes) {
    if (l.statut === 'en_attente') enAttente += 1;
    const { cree } = await reprendre(c, 'expenses', ecole, l.id, {
      amount: montant(l.montant),
      description: l.description,
      spent_at: horodatage(l.date_depense),
      created_by: personnel.get(l.cree_par) ?? null,
      origin: ORIGINE[l.origine] ?? 'migrated',
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (enAttente) {
    decision(
      `⚠ ${enAttente} dépense(s) sont « en attente » chez lui et arrivent ici comme des ` +
        'dépenses ordinaires — `expenses` n’a pas d’état',
    );
  }
  noter({ nom: 'dépenses', lues: lignes.length, creees, majs, ecartees: 0 });
}

async function importerExemptions(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  personnel: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, etudiant_id, type, mois, annee, motif, cree_par, date_creation
       FROM exemptions ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const eleve = eleves.get(l.etudiant_id);
    const mensuelle = l.type === 'mensuelle';
    // ⚠ Sa contrainte : une exemption mensuelle NOMME un mois, une totale non.
    // Une mensuelle sans mois violerait la nôtre au lieu d'être signalée.
    if (!eleve || (mensuelle && (l.mois === null || l.annee === null))) {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'exemptions', ecole, l.id, {
      student_id: eleve,
      kind: mensuelle ? 'monthly' : 'full',
      calendar_month: mensuelle ? l.mois : null,
      calendar_year: mensuelle ? l.annee : null,
      reason: l.motif || null,
      granted_by: personnel.get(l.cree_par) ?? null,
      created_at: horodatage(l.date_creation),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} exemption(s) sans élève ou sans mois nommé — écartée(s)`);
  noter({ nom: 'exemptions', lues: lignes.length, creees, majs, ecartees });
}

/**
 * ⚠ `reductions` SERT LA SCOLARITÉ **ET** LE COURS DU SOIR, par son `contexte`.
 * Seules celles de la scolarité vont dans `discounts` ; celles du cours du soir
 * ont leurs propres tables et viendront avec cette tranche-là.
 */
async function importerReductions(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  personnel: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, contexte, etudiant_id, mois, annee, montant, motif, cree_par, date_creation
       FROM reductions ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let coursDuSoir = 0;
  for (const l of lignes) {
    if (l.contexte !== 'scolarite') {
      coursDuSoir += 1;
      continue;
    }
    const eleve = l.etudiant_id === null ? undefined : eleves.get(l.etudiant_id);
    // Notre contrainte refuse un montant nul ou négatif ; la sienne ne le dit
    // pas, alors on écarte plutôt que de faire échouer toute la reprise.
    if (!eleve || montant(l.montant) === '0.00') {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'discounts', ecole, l.id, {
      student_id: eleve,
      calendar_month: l.mois,
      calendar_year: l.annee,
      amount: montant(l.montant),
      reason: l.motif || null,
      granted_by: personnel.get(l.cree_par) ?? null,
      created_at: horodatage(l.date_creation),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (coursDuSoir) {
    decision(`${coursDuSoir} réduction(s) portent sur le cours du soir — pas cette tranche`);
  }
  if (ecartees) decision(`${ecartees} réduction(s) sans élève ou de montant nul — écartée(s)`);
  noter({ nom: 'réductions', lues: lignes.length, creees, majs, ecartees });
}

/**
 * LES REMISES DE DETTE — révoquées, jamais supprimées.
 *
 * ⚠ Une remise annulée SE GARDE. C'est une décision de direction sur l'argent
 * d'une famille : effacer une remise révoquée effacerait la trace de qui l'avait
 * accordée, et pourquoi. Les deux systèmes la conservent ; l'import aussi.
 */
async function importerRemises(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  correspondants: Carte,
  annees: Carte,
  personnel: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, parent_id, annee_id, montant, annule_tout, motif, accorde_par, date_remise,
            annulee, annulee_par, date_annulation, motif_annulation
       FROM remises_dette ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const parent = correspondants.get(l.parent_id);
    if (!parent) {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'debt_write_offs', ecole, l.id, {
      guardian_id: parent,
      academic_year_id: l.annee_id === null ? null : (annees.get(l.annee_id) ?? null),
      amount: montant(l.montant),
      clears_all: Boolean(l.annule_tout),
      reason: l.motif || null,
      granted_by: personnel.get(l.accorde_par) ?? null,
      created_at: horodatage(l.date_remise),
      revoked_at: l.annulee ? horodatage(l.date_annulation) : null,
      revoked_by: l.annulee ? (personnel.get(l.annulee_par) ?? null) : null,
      revoked_reason: l.annulee ? l.motif_annulation || null : null,
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} remise(s) de dette sans correspondant — écartée(s)`);
  noter({ nom: 'remises', lues: lignes.length, creees, majs, ecartees });
}

/**
 * LES FRAIS ANNUELS — dus UNE FOIS PAR FAMILLE, pas par enfant.
 *
 * ⚠ SON `annee` EST UNE ANNÉE CIVILE DE DÉBUT, pas un identifiant. Un `0`
 * signifie « avant qu'on tienne l'année », et n'a pas d'année scolaire à
 * désigner ici.
 */
async function importerFraisAnnuels(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  correspondants: Carte,
  annees: Carte,
  personnel: Carte,
) {
  const { rows: parAnneeDebut } = await c.query<{ id: string; start_year: number }>(
    'SELECT id, start_year FROM academic_years WHERE school_id = $1',
    [ecole],
  );
  const anneeDe = new Map(parAnneeDebut.map((y) => [y.start_year, y.id]));

  const [paiements] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, parent_id, type_frais, montant, annee, recu_numero, enregistre_par, date_paiement
       FROM parent_paiements_annuels ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of paiements) {
    const parent = correspondants.get(l.parent_id);
    const annee = anneeDe.get(Number(l.annee));
    if (!parent || !annee) {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'family_fee_payments', ecole, l.id, {
      guardian_id: parent,
      academic_year_id: annee,
      kind: l.type_frais === 'photocopie' ? 'photocopy' : 'enrolment',
      amount: montant(l.montant),
      receipt_number: l.recu_numero,
      paper_reference: l.recu_numero,
      recorded_by: personnel.get(l.enregistre_par) ?? null,
      paid_at: horodatage(l.date_paiement),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} frais annuel(s) sans correspondant ou sans année — écarté(s)`);
  noter({ nom: 'frais annuels', lues: paiements.length, creees, majs, ecartees });

  // Les exemptions de frais annuels n'ont pas de `legacy_id` chez nous : leur
  // clé naturelle (famille, type, année) est déjà leur identité.
  const [exemptions] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, parent_id, type_frais, annee, cree_par FROM parent_exemptions ORDER BY id',
  );
  let posees = 0;
  let sautees = 0;
  for (const l of exemptions) {
    const parent = correspondants.get(l.parent_id);
    if (!parent) {
      sautees += 1;
      continue;
    }
    // `annee` nulle veut dire « toutes les années », et se garde nulle.
    const annee = l.annee === null ? null : (anneeDe.get(Number(l.annee)) ?? null);
    if (l.annee !== null && !annee) {
      sautees += 1;
      continue;
    }
    const { rowCount } = await c.query(
      `INSERT INTO family_fee_exemptions (school_id, guardian_id, kind, academic_year_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, guardian_id, kind, academic_year_id) DO NOTHING`,
      [
        ecole,
        parent,
        l.type_frais === 'photocopie' ? 'photocopy' : 'enrolment',
        annee,
        personnel.get(l.cree_par) ?? null,
      ],
    );
    if (rowCount) posees += 1;
  }
  noter({
    nom: 'exempt. frais',
    lues: exemptions.length,
    creees: posees,
    majs: exemptions.length - posees - sautees,
    ecartees: sautees,
  });
}
