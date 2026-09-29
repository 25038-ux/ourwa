import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Check, CheckResult } from '../types.js';
import { empreinte, premierEcart, sou, MYSQL } from './commun.js';

/**
 * LA PAIE ET LES DETTES DIVERSES, DES DEUX CÔTÉS.
 *
 * Salaires, prêts au personnel, échéances de prêt, et les dettes constatées hors
 * scolarité. Ce sont les deux autres flux d'argent de l'école ; après les
 * encaissements, ils ferment le compte.
 *
 * ## ⚠ Les 339 bulletins sans personne se comparent À PART
 *
 * `paiements_salaire` contient 339 lignes à `beneficiaire_id = 0`, nommées
 * « Bulletin de salaire OCT » : les bulletins mensuels du logiciel qui précédait
 * El Ourwa, qu'il a lui-même repris sans pouvoir les rattacher. Notre
 * `payee_id` est obligatoire, et y accrocher un employé fictif inventerait une
 * personne (règle 24). Ils ne sont pas repris.
 *
 * Une mesure qui comparerait le total brut échouerait donc TOUJOURS, de
 * 1 245 990.00 — et une barrière qui échoue par construction cesse d'être lue.
 * Les salaires se comparent donc sur ce qui est ATTRIBUABLE, et une mesure à
 * part dit combien ne l'est pas, pour que le chiffre reste sous les yeux.
 */

export function payrollCheck(slug: string): Check {
  return {
    name: 'paie',
    group: 'payroll',
    async run(): Promise<CheckResult[]> {
      const my = await mysql.createConnection({ ...MYSQL, dateStrings: true });
      const pool = new pg.Pool({
        connectionString:
          process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa',
      });
      const resultats: CheckResult[] = [];

      const mesurer = (name: string, legacy: string, current: string, delta?: string) => {
        const match = legacy === current;
        resultats.push({
          name,
          legacy,
          current,
          match,
          delta: match ? delta : premierEcart(legacy, current) || delta,
        });
      };

      const l = async (sql: string) => {
        const [rows] = await my.query<mysql.RowDataPacket[]>(sql);
        return rows as unknown as Record<string, unknown>[];
      };

      // Le prédicat « rattachable », le même dans chaque requête d'El Ourwa.
      const ATTRIBUABLE = `(
        (beneficiaire_type = 'staff' AND beneficiaire_id IN (SELECT id FROM staff))
        OR (beneficiaire_type = 'professeur' AND beneficiaire_id IN (SELECT id FROM professeurs))
      )`;

      try {
        const { rows: ecoles } = await pool.query<{ id: string }>(
          'SELECT id FROM schools WHERE slug = $1',
          [slug],
        );
        const ecole = ecoles[0]?.id;
        if (!ecole) throw new Error(`Aucune branche « ${slug} ». Lancez d’abord pnpm importer.`);

        const client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_school_id', $1, true)", [ecole]);
        const t = async (sql: string) => {
          const { rows } = await client.query(sql, [ecole]);
          return rows as Record<string, unknown>[];
        };

        try {
          // ── Le personnel ────────────────────────────────────────────────
          mesurer(
            'personnel administratif',
            String((await l('SELECT COUNT(*) n FROM staff'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM staff WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'masse salariale contractuelle',
            sou((await l('SELECT SUM(salaire) s FROM staff WHERE actif = 1'))[0]!.s),
            sou((await t('SELECT SUM(salary) s FROM staff WHERE school_id = $1 AND is_active'))[0]!.s),
          );

          // ── Les salaires ────────────────────────────────────────────────
          mesurer(
            'salaires attribuables',
            String((await l(`SELECT COUNT(*) n FROM paiements_salaire WHERE ${ATTRIBUABLE}`))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM salary_payments WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'salaires versés, attribuables',
            sou((await l(`SELECT SUM(montant) s FROM paiements_salaire WHERE ${ATTRIBUABLE}`))[0]!.s),
            sou((await t('SELECT SUM(net) s FROM salary_payments WHERE school_id = $1'))[0]!.s),
          );

          // ⚠ Le chiffre qui n'est PAS repris, gardé sous les yeux. Il ne peut
          // pas concorder ; il est là pour qu'on ne l'oublie pas.
          const nonAttribuables = await l(
            `SELECT COUNT(*) n, COALESCE(SUM(montant), 0) s FROM paiements_salaire
              WHERE NOT ${ATTRIBUABLE}`,
          );
          resultats.push({
            name: 'bulletins sans personne (non repris)',
            legacy: `${nonAttribuables[0]!.n} · ${sou(nonAttribuables[0]!.s)}`,
            current: '—',
            match: true,
            delta: 'hérités de l’ancien logiciel, bénéficiaire 0 — ADR-0057',
          });

          mesurer(
            'salaires par bénéficiaire et mois',
            empreinte(
              await l(
                `SELECT CONCAT(beneficiaire_type, ':', beneficiaire_id, ':', annee, '-',
                               LPAD(mois, 2, '0')) COLLATE utf8mb4_bin cle,
                        SUM(montant) n
                   FROM paiements_salaire WHERE ${ATTRIBUABLE} GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT CASE sp.payee_kind WHEN 'teacher' THEN 'professeur' ELSE 'staff' END
                        || ':' || COALESCE(s.legacy_id, tc.legacy_id)
                        || ':' || sp.calendar_year || '-' || lpad(sp.calendar_month::text, 2, '0') cle,
                        SUM(sp.net) n
                   FROM salary_payments sp
                   LEFT JOIN staff s     ON s.id = sp.payee_id  AND s.school_id = sp.school_id
                   LEFT JOIN teachers tc ON tc.id = sp.payee_id AND tc.school_id = sp.school_id
                  WHERE sp.school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          // ── Les prêts ───────────────────────────────────────────────────
          mesurer(
            'prêts',
            String((await l('SELECT COUNT(*) n FROM prets_personnel WHERE montant_total > 0'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM staff_loans WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'capital prêté',
            sou((await l('SELECT SUM(montant_total) s FROM prets_personnel'))[0]!.s),
            sou((await t('SELECT SUM(principal) s FROM staff_loans WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'capital remboursé',
            sou((await l('SELECT SUM(montant_rembourse) s FROM prets_personnel'))[0]!.s),
            sou((await t('SELECT SUM(repaid) s FROM staff_loans WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'prêts par état',
            empreinte(
              (await l('SELECT statut cle, COUNT(*) n FROM prets_personnel GROUP BY statut')).map(
                (r) => ({ cle: r.cle === 'solde' ? 'settled' : 'outstanding', n: r.n }),
              ),
            ),
            empreinte(
              await t('SELECT status cle, COUNT(*) n FROM staff_loans WHERE school_id = $1 GROUP BY status'),
            ),
          );

          mesurer(
            'échéances de prêt',
            String((await l('SELECT COUNT(*) n FROM prets_echeances WHERE montant > 0'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM loan_instalments WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'échéances retenues sur salaire',
            String((await l('SELECT COUNT(*) n FROM prets_echeances WHERE retenu_salaire = 1'))[0]!.n),
            String(
              (await t('SELECT COUNT(*) n FROM loan_instalments WHERE school_id = $1 AND withheld'))[0]!.n,
            ),
          );

          mesurer(
            'échéancier de prêt par mois',
            empreinte(
              await l(
                `SELECT CONCAT(annee, '-', LPAD(mois, 2, '0')) COLLATE utf8mb4_bin cle, SUM(montant) n
                   FROM prets_echeances WHERE montant > 0 GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT calendar_year || '-' || lpad(calendar_month::text, 2, '0') cle, SUM(amount) n
                   FROM loan_instalments WHERE school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          // ── Les dettes diverses ─────────────────────────────────────────
          mesurer(
            'dettes constatées',
            String((await l('SELECT COUNT(*) n FROM dettes_familles WHERE total > 0'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM misc_debts WHERE school_id = $1'))[0]!.n),
          );

          // ⚠ Ce que les familles doivent hors scolarité, et ce qu'elles ont rendu.
          mesurer(
            'total des dettes constatées',
            sou((await l('SELECT SUM(total) s FROM dettes_familles WHERE total > 0'))[0]!.s),
            sou((await t('SELECT SUM(total) s FROM misc_debts WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'solde des dettes constatées',
            sou((await l('SELECT SUM(solde) s FROM dettes_familles WHERE total > 0'))[0]!.s),
            sou(
              (await t('SELECT SUM(total - repaid) s FROM misc_debts WHERE school_id = $1'))[0]!.s,
            ),
          );

          mesurer(
            'dettes par nature',
            empreinte(
              await l(
                `SELECT type_dette COLLATE utf8mb4_bin cle, SUM(total) n FROM dettes_familles
                  WHERE total > 0 GROUP BY cle`,
              ),
            ),
            empreinte(
              await t('SELECT kind cle, SUM(total) n FROM misc_debts WHERE school_id = $1 GROUP BY kind'),
            ),
          );

          mesurer(
            'dettes par année',
            empreinte(
              await l(
                `SELECT COALESCE(annee, 0) cle, SUM(total) n FROM dettes_familles
                  WHERE total > 0 GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT COALESCE(start_year, 0) cle, SUM(total) n FROM misc_debts
                  WHERE school_id = $1 GROUP BY 1`,
              ),
            ),
          );
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      } finally {
        await my.end();
        await pool.end();
      }

      return resultats;
    },
  };
}
