import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Check, CheckResult } from '../types.js';
import { empreinte, premierEcart, sou, MYSQL } from './commun.js';
import { moisAutoExempte } from '../../import/commun.js';

/**
 * L'ARGENT — encaissements, ventilation, échéanciers, dépenses.
 *
 * ⚠ C'EST LA VÉRIFICATION QUI DÉCIDE DE LA BASCULE. Les effectifs disent que les
 * élèves sont là ; les notes, que les bulletins seront justes. Celle-ci dit que
 * le successeur réclamerait aux 1 372 familles **exactement** ce qu'El Ourwa leur
 * réclame — ni un ouguiya de plus, ni un de moins. Un écart ici est un défaut
 * bloquant, pas une curiosité d'arrondi (règle 25), et rien ne bascule sur une
 * réconciliation en échec (règle 23).
 *
 * Tout se compare **en chaînes**. Deux totaux de quarante-deux millions qui ne
 * diffèrent que d'un centime doivent se voir, et c'est précisément ce que
 * l'arithmétique flottante efface.
 *
 * ## Ce qui est mesuré, et pourquoi chaque mesure existe
 *
 * - **Le total encaissé**, puis **par année**, **par mois**, **par jour**. Un
 *   total juste dont la répartition est fausse, ce sont des rapports de caisse
 *   faux tous les jours de l'année.
 * - **`origin`**, à part. Un encaissement `imputed` a été reconstitué depuis une
 *   somme globale ; ce n'est pas un encaissement constaté, et le jour où une
 *   famille conteste, la différence est toute la conversation.
 * - **La ventilation par moyen de paiement.** C'est elle qui dit combien il doit
 *   y avoir dans la caisse, et combien sur Bankily.
 * - **L'échéancier** : le nombre de mois, leur état, et surtout la **somme
 *   restant due**, qui est la dette avant remise.
 */

export function financeCheck(slug: string): Check {
  return {
    name: 'finance',
    group: 'finance',
    async run(): Promise<CheckResult[]> {
      const my = await mysql.createConnection({ ...MYSQL, dateStrings: true });
      const pool = new pg.Pool({
        connectionString:
          process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa',
      });
      const resultats: CheckResult[] = [];

      const mesurer = (name: string, legacy: string, current: string) => {
        const match = legacy === current;
        resultats.push({
          name,
          legacy,
          current,
          match,
          delta: match ? undefined : premierEcart(legacy, current) || undefined,
        });
      };

      const l = async (sql: string) => {
        const [rows] = await my.query<mysql.RowDataPacket[]>(sql);
        return rows as unknown as Record<string, unknown>[];
      };

      try {
        const { rows: ecoles } = await pool.query<{ id: string }>(
          'SELECT id FROM schools WHERE slug = $1',
          [slug],
        );
        const ecole = ecoles[0]?.id;
        if (!ecole) throw new Error(`Aucune branche « ${slug} ». Lancez d’abord pnpm importer.`);

        // Sans locataire, RLS rend zéro sans erreur (règle 2).
        const client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_school_id', $1, true)", [ecole]);
        const t = async (sql: string) => {
          const { rows } = await client.query(sql, [ecole]);
          return rows as Record<string, unknown>[];
        };

        try {
          // ── Les encaissements ───────────────────────────────────────────
          mesurer(
            'encaissements',
            String((await l('SELECT COUNT(*) n FROM paiements'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM payments WHERE school_id = $1'))[0]!.n),
          );

          // ⚠ LA MESURE QUI DÉCIDE.
          mesurer(
            'total encaissé',
            sou((await l('SELECT SUM(montant) s FROM paiements'))[0]!.s),
            sou((await t('SELECT SUM(amount) s FROM payments WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'encaissé par année scolaire',
            empreinte(
              await l(
                `SELECT a.libelle COLLATE utf8mb4_bin cle, SUM(p.montant) n FROM paiements p
                   JOIN annees_scolaires a ON a.id = p.annee_id GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT y.label cle, SUM(p.amount) n FROM payments p
                   JOIN academic_years y ON y.id = p.academic_year_id AND y.school_id = p.school_id
                  WHERE p.school_id = $1 GROUP BY y.label`,
              ),
            ),
          );

          // Le mois auquel l'encaissement se rapporte — pas la date de caisse.
          mesurer(
            'encaissé par mois couvert',
            empreinte(
              await l(
                `SELECT CONCAT(annee, '-', LPAD(mois, 2, '0')) COLLATE utf8mb4_bin cle,
                        SUM(montant) n FROM paiements GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT calendar_year || '-' || lpad(calendar_month::text, 2, '0') cle,
                        SUM(amount) n FROM payments WHERE school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          // ⚠ Le piège du fuseau, sur la date de caisse cette fois : un décalage
          // d'une heure ferait basculer une recette du 1er au 31 précédent, et
          // deux rapports de caisse seraient faux.
          mesurer(
            'encaissé par jour de caisse',
            empreinte(
              await l(
                `SELECT DATE(date_paiement) COLLATE utf8mb4_bin cle, SUM(montant) n
                   FROM paiements GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT (paid_at AT TIME ZONE 'Africa/Nouakchott')::date::text cle, SUM(amount) n
                   FROM payments WHERE school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          // ⚠ `origine` porte le SENS, pas la provenance : un encaissement saisi
          // à la main est `native`, un reconstitué est `imputed`. 17 106 lignes
          // en dépendent et les rapports financiers s'en servent.
          mesurer(
            'encaissements par origine',
            empreinte(
              (await l('SELECT origine cle, COUNT(*) n FROM paiements GROUP BY origine')).map(
                (r) => ({
                  cle: { reprise: 'migrated', elourwa: 'native', impute: 'imputed' }[
                    String(r.cle)
                  ]!,
                  n: r.n,
                }),
              ),
            ),
            empreinte(
              await t(
                'SELECT origin cle, COUNT(*) n FROM payments WHERE school_id = $1 GROUP BY origin',
              ),
            ),
          );

          // Le numéro du carnet à souches : c'est ce que la famille a en main.
          mesurer(
            'numéros de reçu distincts',
            String((await l('SELECT COUNT(DISTINCT recu_numero) n FROM paiements'))[0]!.n),
            String(
              (await t('SELECT COUNT(DISTINCT paper_reference) n FROM payments WHERE school_id = $1'))[0]!
                .n,
            ),
          );

          // ── La ventilation ──────────────────────────────────────────────
          mesurer(
            'lignes de ventilation',
            String(
              (await l("SELECT COUNT(*) n FROM paiement_lignes WHERE source_type = 'paiement'"))[0]!
                .n,
            ),
            String(
              (
                await t(
                  `SELECT COUNT(*) n FROM tender_lines
                    WHERE school_id = $1 AND source_type = 'paiement'`,
                )
              )[0]!.n,
            ),
          );

          // ⚠ LA CAISSE PAR MOIS. Les 16 008 lignes reprises portaient toutes le
          // jour de la reprise (14/09) : chaque rapport de caisse attribuait
          // 42,6 M MRU de deux années à un seul mois, et rien ici ne le
          // voyait — la ventilation n'était comparée que par moyen.
          mesurer(
            'ventilé par mois',
            empreinte(
              await l(
                `SELECT DATE_FORMAT(pl.date_creation, '%Y-%m') COLLATE utf8mb4_bin cle, SUM(pl.montant) n
                   FROM paiement_lignes pl WHERE pl.source_type = 'paiement' GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT to_char(tl.created_at, 'YYYY-MM') cle, SUM(tl.amount) n FROM tender_lines tl
                  WHERE tl.school_id = $1 AND tl.source_type = 'paiement' GROUP BY 1`,
              ),
            ),
          );

          // ⚠ Ce que la caisse doit contenir, et ce qui est passé par Bankily.
          mesurer(
            'ventilé par moyen de paiement',
            empreinte(
              await l(
                `SELECT m.nom COLLATE utf8mb4_bin cle, SUM(pl.montant) n
                   FROM paiement_lignes pl JOIN moyens_paiement m ON m.id = pl.moyen_id
                  WHERE pl.source_type = 'paiement' GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT pm.name cle, SUM(tl.amount) n FROM tender_lines tl
                   JOIN payment_methods pm
                     ON pm.id = tl.payment_method_id AND pm.school_id = tl.school_id
                  WHERE tl.school_id = $1 AND tl.source_type = 'paiement' GROUP BY pm.name`,
              ),
            ),
          );

          mesurer(
            'ventilé par sens',
            empreinte(
              (
                await l(
                  `SELECT sens cle, SUM(montant) n FROM paiement_lignes
                    WHERE source_type = 'paiement' GROUP BY sens`,
                )
              ).map((r) => ({ cle: r.cle === 'sortant' ? 'out' : 'in', n: r.n })),
            ),
            empreinte(
              await t(
                `SELECT direction cle, SUM(amount) n FROM tender_lines
                  WHERE school_id = $1 AND source_type = 'paiement' GROUP BY direction`,
              ),
            ),
          );

          // ── L'échéancier ────────────────────────────────────────────────
          mesurer(
            'mois d’échéancier',
            String((await l('SELECT COUNT(*) n FROM inscription_mois'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM enrollment_months WHERE school_id = $1'))[0]!.n),
          );

          // ⚠ SON ÉTAT BRUT NE SE COMPARE PAS AU NÔTRE TEL QUEL. Il exempte au
          // moment du calcul les mois d'avant l'entrée de l'élève ; l'import les
          // a écrits `free`. On applique donc sa règle à ses lignes avant de
          // compter — c'est la traduction qu'on vérifie, pas la copie.
          const etats = new Map<string, number>();
          for (const r of await l(
            `SELECT im.statut, im.mois_ordre, ei.annee, e.date_inscription,
                    a.mois_debut, a.mois_fin
               FROM inscription_mois im
               JOIN etudiant_inscriptions ei ON ei.id = im.inscription_id
               JOIN etudiants e ON e.id = ei.etudiant_id
               JOIN annees_scolaires a ON a.id = ei.annee_id`,
          )) {
            let etat = { a_facturer: 'billable', facture: 'invoiced', gratuit: 'free' }[
              String(r.statut)
            ]!;
            const ord = Number(r.mois_ordre);
            const debut = Number(r.mois_debut);
            // Rang → mois civil, par la même liste que l'import (Oct..Juin).
            const mois = ((debut - 1 + ord - 1) % 12) + 1;
            const an = mois >= debut ? Number(r.annee) : Number(r.annee) + 1;
            if (
              etat === 'billable' &&
              moisAutoExempte(
                r.date_inscription as string | null,
                Number(r.annee),
                mois,
                an,
                debut,
                Number(r.mois_fin),
              )
            ) {
              etat = 'free';
            }
            etats.set(etat, (etats.get(etat) ?? 0) + 1);
          }
          mesurer(
            'mois par état',
            empreinte([...etats.entries()].map(([cle, n]) => ({ cle, n }))),
            empreinte(
              await t(
                'SELECT status cle, COUNT(*) n FROM enrollment_months WHERE school_id = $1 GROUP BY status',
              ),
            ),
          );

          // ⚠ LA DETTE AVANT REMISE. C'est ce que l'école réclamerait demain.
          mesurer(
            'total restant dû',
            sou((await l('SELECT SUM(montant_du) s FROM inscription_mois'))[0]!.s),
            sou(
              (await t('SELECT SUM(amount_due) s FROM enrollment_months WHERE school_id = $1'))[0]!
                .s,
            ),
          );

          // ⚠ ET SA RÉPARTITION SUR LE CALENDRIER. Le rang `mois_ordre` d'El Ourwa
          // devient ici un mois civil ; se tromper d'un rang décalerait tout
          // l'échéancier d'une famille d'un mois. Cette mesure le verrait.
          mesurer(
            'restant dû par mois civil',
            empreinte(
              await l(
                `SELECT CONCAT(a.annee_debut, ':', im.mois_ordre) COLLATE utf8mb4_bin cle,
                        SUM(im.montant_du) n
                   FROM inscription_mois im
                   JOIN etudiant_inscriptions i ON i.id = im.inscription_id
                   JOIN annees_scolaires a ON a.id = i.annee_id
                  GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT y.start_year || ':' || m.month_order cle, SUM(m.amount_due) n
                   FROM enrollment_months m
                   JOIN enrollments e ON e.id = m.enrollment_id AND e.school_id = m.school_id
                   JOIN academic_years y
                     ON y.id = e.academic_year_id AND y.school_id = e.school_id
                  WHERE m.school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          mesurer(
            'mois couverts par une facture héritée',
            String((await l('SELECT COUNT(*) n FROM inscription_mois WHERE couvert_facture = 1'))[0]!.n),
            String(
              (
                await t(
                  `SELECT COUNT(*) n FROM enrollment_months
                    WHERE school_id = $1 AND covered_by_invoice`,
                )
              )[0]!.n,
            ),
          );

          // ── Les dépenses et les moyens ──────────────────────────────────
          mesurer(
            'dépenses',
            String((await l('SELECT COUNT(*) n FROM depenses'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM expenses WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'total dépensé',
            sou((await l('SELECT SUM(montant) s FROM depenses'))[0]!.s),
            sou((await t('SELECT SUM(amount) s FROM expenses WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'moyens de paiement',
            empreinte(
              await l('SELECT nom COLLATE utf8mb4_bin cle, actif n FROM moyens_paiement'),
            ),
            empreinte(
              await t(
                `SELECT name cle, CASE WHEN is_active THEN 1 ELSE 0 END n
                   FROM payment_methods WHERE school_id = $1`,
              ),
            ),
          );

          // Les archives que sa « Synthèse — Année scolaire » lit : les reçus
          // d'origine (nombre et somme) et la caisse-dépenses 560011.
          mesurer(
            'reçus d’archive (nombre)',
            String((await l('SELECT COUNT(*) n FROM recus'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM legacy_receipts WHERE school_id = $1'))[0]!.n),
          );
          mesurer(
            'reçus d’archive (somme encaissée)',
            sou((await l('SELECT SUM(montant_paye) s FROM recus'))[0]!.s),
            sou((await t('SELECT SUM(amount_paid) s FROM legacy_receipts WHERE school_id = $1'))[0]!.s),
          );
          mesurer(
            'caisse-dépenses 560011 (débit)',
            sou((await l("SELECT SUM(debit) s FROM compta_lignes WHERE compte = '560011'"))[0]!.s),
            sou(
              (await t(
                "SELECT SUM(debit) s FROM legacy_ledger_lines WHERE school_id = $1 AND account = '560011'",
              ))[0]!.s,
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
