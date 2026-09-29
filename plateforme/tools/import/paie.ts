import type mysql from 'mysql2/promise';
import type pg from 'pg';
import Decimal from 'decimal.js';
import { decision, horodatage, jour, montant, noter, reprendre, type Carte } from './commun.js';

/**
 * LA PAIE ET LES DETTES DIVERSES — personnel administratif, salaires, prêts,
 * échéances de prêt, et les dettes hors scolarité.
 *
 * ⚠ DEUX POPULATIONS, UNE PAIE. El Ourwa paie le personnel administratif
 * (`staff`) et les professeurs (`professeurs`) depuis la même table, par un
 * `beneficiaire_type` polymorphe. Notre `salary_payments` fait pareil, avec
 * `payee_kind`. Chaque salaire doit donc retrouver SON bénéficiaire dans la bonne
 * carte — un salaire de professeur pointé sur un membre du staff de même
 * numéro serait payé à la mauvaise personne, et rien ne le dirait.
 *
 * ⚠ ET UN SALAIRE CHEZ LUI N'A QU'UN MONTANT. Pas de brut, pas de retenue, pas
 * de net : `montant` est ce qui a été remis. Notre table en a trois. On pose
 * `gross = net = montant` et `loan_deduction = 0`, ce qui est la seule lecture
 * qui n'invente rien (règle 24). Le jour où une retenue est faite ICI, elle sera
 * dans sa colonne ; celles faites chez lui sont dans `prets_echeances.retenu_salaire`.
 */

const ORIGINE: Record<string, string> = {
  reprise: 'migrated',
  elourwa: 'native',
};

export async function importerPaie(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  professeurs: Carte,
  personnel: Carte,
  eleves: Carte,
  correspondants: Carte,
) {
  const staff = await importerStaff(my, c, ecole);
  const beneficiaire = (type: string, id: number) =>
    type === 'professeur' ? professeurs.get(id) : staff.get(id);
  const nomDe = await nomsDesBeneficiaires(my);

  await importerSalaires(my, c, ecole, beneficiaire, nomDe, personnel);
  const prets = await importerPrets(my, c, ecole, beneficiaire, nomDe, personnel);
  await importerEcheances(my, c, ecole, prets);
  await importerDettesDiverses(my, c, ecole, eleves, correspondants);
}

async function importerStaff(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, nom, prenom, sexe, telephone, fonction, salaire, date_embauche, actif, date_creation
       FROM staff ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  for (const l of lignes) {
    const { id, cree } = await reprendre(
      c,
      'staff',
      ecole,
      l.id,
      {
        first_name: l.prenom || '',
        last_name: l.nom || '',
        sex: l.sexe,
        phone: l.telephone || null,
        role_title: l.fonction,
        salary: montant(l.salaire),
        hired_on: jour(l.date_embauche),
        is_active: l.actif === null ? true : Boolean(l.actif),
      },
      { created_at: horodatage(l.date_creation) ?? new Date().toISOString() },
    );
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  noter({ nom: 'personnel admin.', lues: lignes.length, creees, majs, ecartees: 0 });
  return carte;
}

/**
 * Le nom à écrire sur la ligne de paie. `payee_name` est NOT NULL chez nous
 * parce qu'un salaire doit rester lisible même si la personne quitte l'école et
 * que sa fiche disparaît ; El Ourwa ne le renseigne que quand le rattachement a
 * échoué. On le résout donc depuis les fiches, avec son `beneficiaire_nom` en
 * repli.
 */
async function nomsDesBeneficiaires(my: mysql.Connection) {
  const [staff] = await my.query<mysql.RowDataPacket[]>(
    "SELECT CONCAT('staff:', id) cle, TRIM(CONCAT(prenom, ' ', nom)) nom FROM staff",
  );
  const [profs] = await my.query<mysql.RowDataPacket[]>(
    "SELECT CONCAT('professeur:', id) cle, TRIM(CONCAT(prenom, ' ', nom)) nom FROM professeurs",
  );
  const noms = new Map<string, string>();
  for (const r of [...staff, ...profs]) noms.set(String(r.cle), String(r.nom));
  return (type: string, id: number, repli: unknown): string =>
    noms.get(`${type}:${id}`) || String(repli ?? '') || `${type} ${id}`;
}

async function importerSalaires(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  beneficiaire: (type: string, id: number) => string | undefined,
  nomDe: (type: string, id: number, repli: unknown) => string,
  personnel: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, beneficiaire_type, beneficiaire_id, montant, mois, annee, motif, paye_par,
            date_paiement, origine, beneficiaire_nom
       FROM paiements_salaire ORDER BY id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let sansFiche = 0;
  let sommeSansFiche = new Decimal(0);
  for (const l of lignes) {
    const cible = beneficiaire(l.beneficiaire_type, l.beneficiaire_id);
    if (!cible) {
      // ⚠ CE NE SONT PAS DES PERSONNES. `beneficiaire_id = 0`, et le nom dit
      // « Bulletin de salaire OCT » : ce sont les bulletins mensuels du logiciel
      // qui précédait El Ourwa, qu'il a lui-même repris sans pouvoir les
      // rattacher — son propre commentaire le dit. Notre `payee_id` est
      // obligatoire ; y accrocher une fiche « Bulletin de salaire » inventerait
      // un employé (règle 24). On les compte, avec leur argent, et la
      // réconciliation compare ce qui est attribuable.
      sansFiche += 1;
      sommeSansFiche = sommeSansFiche.plus(montant(l.montant));
      ecartees += 1;
      continue;
    }
    const somme = montant(l.montant);
    const { cree } = await reprendre(c, 'salary_payments', ecole, l.id, {
      payee_kind: l.beneficiaire_type === 'professeur' ? 'teacher' : 'staff',
      payee_id: cible,
      payee_name: nomDe(l.beneficiaire_type, l.beneficiaire_id, l.beneficiaire_nom),
      calendar_month: l.mois,
      calendar_year: l.annee,
      gross: somme,
      loan_deduction: '0',
      net: somme,
      note: l.motif || null,
      paid_by: personnel.get(l.paye_par) ?? null,
      paid_at: horodatage(l.date_paiement),
      origin: ORIGINE[l.origine] ?? 'migrated',
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (sansFiche) {
    decision(
      `⚠ ${sansFiche} bulletin(s) de salaire sans personne rattachable (bénéficiaire 0, ` +
        `hérités de l’ancien logiciel) — ${sommeSansFiche.toFixed(2)} non repris, ` +
        'comparés à part dans la réconciliation (ADR-0057)',
    );
  }
  decision(
    'paiements_salaire.montant : un seul montant chez lui — repris en brut ET net, retenue ' +
      'à zéro ; les retenues de prêt faites chez lui sont dans `loan_instalments.withheld`',
  );
  noter({ nom: 'salaires', lues: lignes.length, creees, majs, ecartees });
}

async function importerPrets(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  beneficiaire: (type: string, id: number) => string | undefined,
  nomDe: (type: string, id: number, repli: unknown) => string,
  personnel: Carte,
): Promise<Carte> {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT id, beneficiaire_type, beneficiaire_id, montant_total, montant_rembourse, motif,
            statut, cree_par, date_creation
       FROM prets_personnel ORDER BY id`,
  );
  const carte: Carte = new Map();
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const cible = beneficiaire(l.beneficiaire_type, l.beneficiaire_id);
    // `principal > 0` est une contrainte chez nous ; un prêt nul n'en est pas un.
    if (!cible || montant(l.montant_total) === '0.00') {
      ecartees += 1;
      continue;
    }
    const { id, cree } = await reprendre(c, 'staff_loans', ecole, l.id, {
      payee_kind: l.beneficiaire_type === 'professeur' ? 'teacher' : 'staff',
      payee_id: cible,
      payee_name: nomDe(l.beneficiaire_type, l.beneficiaire_id, null),
      principal: montant(l.montant_total),
      repaid: montant(l.montant_rembourse),
      reason: l.motif || null,
      status: l.statut === 'solde' ? 'settled' : 'outstanding',
      granted_by: personnel.get(l.cree_par) ?? null,
      granted_at: horodatage(l.date_creation),
    });
    carte.set(l.id, id);
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} prêt(s) sans bénéficiaire ou de montant nul — écarté(s)`);
  noter({ nom: 'prêts', lues: lignes.length, creees, majs, ecartees });
  return carte;
}

async function importerEcheances(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  prets: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    'SELECT id, pret_id, mois, annee, montant, rembourse, retenu_salaire FROM prets_echeances ORDER BY id',
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  for (const l of lignes) {
    const pret = prets.get(l.pret_id);
    if (!pret || montant(l.montant) === '0.00') {
      ecartees += 1;
      continue;
    }
    const { cree } = await reprendre(c, 'loan_instalments', ecole, l.id, {
      loan_id: pret,
      calendar_month: l.mois,
      calendar_year: l.annee,
      amount: montant(l.montant),
      repaid: montant(l.rembourse),
      withheld: Boolean(l.retenu_salaire),
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} échéance(s) sans prêt ou de montant nul — écartée(s)`);
  noter({ nom: 'échéances', lues: lignes.length, creees, majs, ecartees });
}

/**
 * LES DETTES DIVERSES — `dettes_familles` → `misc_debts`.
 *
 * ⚠ CE N'EST PAS LA DETTE DE SCOLARITÉ. Celle-là se CALCULE depuis l'échéancier
 * et les encaissements ; personne ne la stocke. `dettes_familles` porte les
 * dettes CONSTATÉES : un arriéré hérité de l'ancien logiciel, une facture
 * jamais soldée. Elles se règlent à part et apparaissent dans les Impayés à
 * côté de la scolarité.
 *
 * ⚠ SES CINQ POSTES DEVIENNENT UN TOTAL. `arriere`, `reste_inscription`,
 * `reste_livre`, `reste_fourniture`, `reste_mensualites` sont le détail ; notre
 * `misc_debts` ne porte que `total` et `repaid`, avec `reason` pour dire de quoi
 * il s'agit. Le détail est reconstruit dans `reason` pour rester lisible sur
 * la ligne, et la réconciliation compare le TOTAL — c'est lui que la famille
 * doit.
 *
 * `solde` = `total` − remboursements ; donc `repaid` = `total` − `solde`.
 */
async function importerDettesDiverses(
  my: mysql.Connection,
  c: pg.PoolClient,
  ecole: string,
  eleves: Carte,
  correspondants: Carte,
) {
  const [lignes] = await my.query<mysql.RowDataPacket[]>(
    `SELECT d.id, d.etudiant_id, d.parent_id, d.annee_id, d.annee, d.arriere,
            d.reste_inscription, d.reste_livre, d.reste_fourniture, d.reste_mensualites,
            d.total, d.solde, d.origine, d.type_dette, d.facture_source, d.piece,
            d.correction_motif,
            COALESCE(p.nom_complet, TRIM(CONCAT(e.prenom, ' ', e.nom))) AS nom,
            COALESCE(p.telephone, e.telephone_parent) AS telephone
       FROM dettes_familles d
       LEFT JOIN parents p ON p.id = d.parent_id
       LEFT JOIN etudiants e ON e.id = d.etudiant_id
      ORDER BY d.id`,
  );
  let creees = 0;
  let majs = 0;
  let ecartees = 0;
  let corrigees = 0;
  for (const l of lignes) {
    const total = montant(l.total);
    // `total > 0` est une contrainte chez nous : une dette nulle n'en est pas.
    if (total === '0.00' || total.startsWith('-')) {
      ecartees += 1;
      continue;
    }
    if (l.correction_motif) corrigees += 1;

    const postes = [
      ['arriéré', l.arriere],
      ['inscription', l.reste_inscription],
      ['livres', l.reste_livre],
      ['fournitures', l.reste_fourniture],
      ['mensualités', l.reste_mensualites],
    ]
      .filter(([, v]) => montant(v) !== '0.00')
      .map(([k, v]) => `${k} ${montant(v)}`)
      .join(', ');

    // Remboursé = total − solde. Les deux sont à lui ; `Decimal`, jamais `number`
    // (règle 6), et la soustraction est la seule chose faite ici.
    const repaid = new Decimal(total).minus(montant(l.solde)).toFixed(2);

    const { cree } = await reprendre(c, 'misc_debts', ecole, l.id, {
      student_id: l.etudiant_id === null ? null : (eleves.get(l.etudiant_id) ?? null),
      guardian_id: l.parent_id === null ? null : (correspondants.get(l.parent_id) ?? null),
      debtor_name: l.nom || `dette ${l.id}`,
      phone: l.telephone || null,
      total,
      repaid,
      reason: [postes, l.piece ? `pièce ${l.piece}` : null, l.correction_motif]
        .filter(Boolean)
        .join(' · ') || null,
      kind: l.type_dette,
      start_year: l.annee ?? null,
      invoice_source: l.facture_source ?? null,
      origin: ORIGINE[l.origine] ?? 'migrated',
    });
    if (cree) creees += 1;
    else majs += 1;
  }
  if (ecartees) decision(`${ecartees} dette(s) de total nul ou négatif — écartée(s)`);
  if (corrigees) decision(`${corrigees} dette(s) portent une correction — motif gardé dans reason`);
  decision(
    'dettes_familles : les cinq postes deviennent `total`, leur détail est dans `reason` ; ' +
      'la réconciliation compare le total, qui est ce que la famille doit',
  );
  noter({ nom: 'dettes diverses', lues: lignes.length, creees, majs, ecartees });
}
