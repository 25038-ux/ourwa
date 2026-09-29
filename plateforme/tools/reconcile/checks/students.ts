import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Check, CheckResult } from '../types.js';
import { empreinte, premierEcart, sou, MYSQL } from './commun.js';

/**
 * LES EFFECTIFS ET LES MONTANTS PORTÉS PAR LES INSCRIPTIONS, DES DEUX CÔTÉS.
 *
 * `tools/import` vient d'écrire 7 304 lignes. La seule question qui vaille est
 * de savoir si ce sont les mêmes que chez lui — et « ça a l'air bon » n'est pas
 * une réponse dans un système qui tient les frais de 1 372 familles.
 *
 * Chaque mesure est posée **deux fois**, une requête d'agrégat de chaque côté,
 * puis comparée **en chaînes** (règle 25). Jamais en `number` : deux totaux qui
 * ne diffèrent que d'un centime doivent se voir, et c'est exactement ce que
 * l'arithmétique flottante efface.
 *
 * ## Les empreintes
 *
 * Comparer « 2 153 élèves des deux côtés » ne prouve pas grand-chose : deux
 * erreurs peuvent se compenser. Là où la répartition importe — par niveau, par
 * statut, par lieu de naissance — la mesure est une **empreinte** :
 * `clé=compte|clé=compte|…` trié, comparé caractère par caractère. Un seul élève
 * mal rattaché la fait diverger, et l'écart nomme la clé fautive.
 *
 * ## Les deux pièges que ces mesures visent précisément
 *
 * ⚠ `lieu_naissance` → `place_of_birth`, pas `address`. La migration 0018
 * corrige exactement cette erreur ; l'empreinte des lieux de naissance la
 * rattraperait si elle revenait.
 *
 * ⚠ Les dates. MySQL `datetime` ne porte pas de fuseau, et une interprétation
 * dans le fuseau du poste décalerait `date_entree` d'un jour — assez pour
 * changer le premier mois dû, donc ce que l'école réclame. L'empreinte des
 * dates d'entrée par mois le verrait immédiatement.
 *
 * ## ⚠ ET UN PIÈGE DANS LA COMPARAISON ELLE-MÊME : LA COLLATION
 *
 * El Ourwa est en `utf8mb4_unicode_ci` — **insensible à la casse et aux
 * accents**. Un `GROUP BY` sur du texte y replie donc « Ksar » et « ksar »,
 * « NKT », « Nkt » et « nkt », « Boghe » et « Boghé », en un seul groupe.
 * Postgres regroupe exactement. Comparées telles quelles, les deux empreintes
 * des lieux de naissance divergeaient sur une trentaine de clés — alors que les
 * valeurs stockées étaient identiques des deux côtés : 95 + 13 + 4 = 112, et
 * « nkt 112 » est justement le chiffre relevé dans `CLAUDE.md`.
 *
 * Une vérification qui échoue sur une différence de collation ne vérifie plus
 * les données, elle vérifie les réglages. **Tout regroupement sur du texte est
 * donc forcé en `utf8mb4_bin` du côté MySQL**, pour que les deux bases
 * regroupent pareil. Et ce n'est pas que cosmétique dans l'autre sens : sans
 * cela, deux niveaux qui ne différeraient que par la casse seraient repliés chez
 * lui et un vrai écart passerait inaperçu.
 */

export function studentsCheck(slug: string): Check {
  return {
    name: 'effectifs',
    group: 'students',
    async run(): Promise<CheckResult[]> {
      const my = await mysql.createConnection({ ...MYSQL, dateStrings: true });
      const pool = new pg.Pool({
        connectionString:
          process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa',
      });
      const resultats: CheckResult[] = [];

      /** Une mesure, posée des deux côtés. */
      const mesurer = (name: string, legacy: string, current: string, comment?: string) => {
        const match = legacy === current;
        resultats.push({
          name,
          legacy,
          current,
          match,
          delta: match ? comment : (comment ?? premierEcart(legacy, current)) || undefined,
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

        // ⚠ RLS EXIGE UN LOCATAIRE, ET SANS LUI TOUT REND ZÉRO SANS ERREUR. Un
        // rapprochement « 2153 contre 0 » ressemblerait à un import raté alors
        // que le défaut serait ici. `set_config(..., true)` reste local à la
        // transaction (règle 2) : un `SET` nu resterait sur la connexion du pool.
        const client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_school_id', $1, true)", [ecole]);
        const t = async (sql: string, params: unknown[] = []) => {
          const { rows } = await client.query(sql, [ecole, ...params]);
          return rows as Record<string, unknown>[];
        };

        try {
          // ── Les gens ────────────────────────────────────────────────────
          mesurer(
            'élèves',
            String((await l('SELECT COUNT(*) n FROM etudiants'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM students WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'élèves sortis',
            String((await l('SELECT COUNT(*) n FROM etudiants WHERE sorti = 1'))[0]!.n),
            String(
              (await t('SELECT COUNT(*) n FROM students WHERE school_id = $1 AND has_left'))[0]!.n,
            ),
          );

          mesurer(
            'correspondants',
            String((await l('SELECT COUNT(*) n FROM parents'))[0]!.n),
            String(
              (
                await t(
                  `SELECT COUNT(DISTINCT usr.user_id) n FROM user_school_roles usr
                     JOIN roles r ON r.id = usr.role_id
                    WHERE usr.school_id = $1 AND r.code = 'parent'`,
                )
              )[0]!.n,
            ),
          );

          mesurer(
            'élèves rattachés à un correspondant',
            String((await l('SELECT COUNT(*) n FROM etudiants WHERE parent_id IS NOT NULL'))[0]!.n),
            String(
              (
                await t(
                  'SELECT COUNT(*) n FROM students WHERE school_id = $1 AND guardian_id IS NOT NULL',
                )
              )[0]!.n,
            ),
          );

          mesurer(
            'répartition par sexe',
            empreinte(
              (await l('SELECT COALESCE(sexe,"∅") cle, COUNT(*) n FROM etudiants GROUP BY sexe')),
            ),
            empreinte(
              (await t(
                `SELECT COALESCE(sex, '∅') cle, COUNT(*) n FROM students
                  WHERE school_id = $1 GROUP BY sex`,
              )),
            ),
          );

          // ⚠ C'est la mesure qui prouve que « Arafat » et « Guerou » ont atterri
          // dans `place_of_birth` et non dans `address` (migration 0018).
          mesurer(
            'lieux de naissance',
            empreinte(
              (await l(
                `SELECT COALESCE(NULLIF(TRIM(lieu_naissance),''),'∅')
                          COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM etudiants GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT COALESCE(NULLIF(TRIM(place_of_birth),''),'∅') cle, COUNT(*) n
                   FROM students WHERE school_id = $1 GROUP BY 1`,
              )),
            ),
          );

          // ── Le référentiel ──────────────────────────────────────────────
          for (const [nom, sqlMy, sqlPg] of [
            ['niveaux', 'SELECT COUNT(*) n FROM niveaux', 'SELECT COUNT(*) n FROM levels WHERE school_id = $1'],
            ['groupes', 'SELECT COUNT(*) n FROM groupes', 'SELECT COUNT(*) n FROM groups WHERE school_id = $1'],
            ['matières', 'SELECT COUNT(*) n FROM matieres', 'SELECT COUNT(*) n FROM subjects WHERE school_id = $1'],
            ['années scolaires', 'SELECT COUNT(*) n FROM annees_scolaires', 'SELECT COUNT(*) n FROM academic_years WHERE school_id = $1'],
          ] as const) {
            mesurer(nom, String((await l(sqlMy))[0]!.n), String((await t(sqlPg))[0]!.n));
          }

          mesurer(
            'tarifs des niveaux',
            empreinte(
              (await l(
                'SELECT nom COLLATE utf8mb4_bin cle, tarif_mensuel n FROM niveaux',
              )),
            ),
            empreinte(
              (await t('SELECT name cle, monthly_rate n FROM levels WHERE school_id = $1')),
            ),
          );

          // ⚠ Un mois décoché chez lui ne doit pas devenir payable ici : ce serait
          // un mois de scolarité inventé pour chaque famille à la fois.
          mesurer(
            'mois facturés par année',
            empreinte(
              (await l(
                `SELECT a.libelle COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM annee_scolaire_mois m
                   JOIN annees_scolaires a
                     ON a.annee_debut = IF(m.mois >= a.mois_debut, m.annee, m.annee - 1)
                  WHERE m.actif = 1 GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT y.label cle, COUNT(*) n FROM academic_year_months m
                   JOIN academic_years y ON y.id = m.academic_year_id AND y.school_id = m.school_id
                  WHERE m.school_id = $1 GROUP BY y.label`,
              )),
            ),
          );

          // ── Les inscriptions ────────────────────────────────────────────
          mesurer(
            'inscriptions',
            String((await l('SELECT COUNT(*) n FROM etudiant_inscriptions'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM enrollments WHERE school_id = $1'))[0]!.n),
          );

          const STATUT: Record<string, string> = {
            inscrit: 'enrolled',
            archive: 'archived',
            bloque_dette: 'debt_blocked',
            annule: 'cancelled',
          };
          mesurer(
            'inscriptions par statut',
            empreinte(
              (
                await l('SELECT statut cle, COUNT(*) n FROM etudiant_inscriptions GROUP BY statut')
              ).map((r) => ({ cle: STATUT[String(r.cle)] ?? String(r.cle), n: r.n })),
            ),
            empreinte(
              (await t(
                'SELECT status cle, COUNT(*) n FROM enrollments WHERE school_id = $1 GROUP BY status',
              )),
            ),
          );

          mesurer(
            'inscriptions par année',
            empreinte(
              (await l(
                `SELECT a.libelle COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM etudiant_inscriptions i
                   JOIN annees_scolaires a ON a.id = i.annee_id GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT y.label cle, COUNT(*) n FROM enrollments e
                   JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = e.school_id
                  WHERE e.school_id = $1 GROUP BY y.label`,
              )),
            ),
          );

          mesurer(
            'effectif par niveau',
            empreinte(
              (await l(
                `SELECT CONCAT(a.libelle, ' · ', n.nom) COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM etudiant_inscriptions i
                   JOIN annees_scolaires a ON a.id = i.annee_id
                   JOIN niveaux n ON n.id = i.niveau_id
                  GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT y.label || ' · ' || lv.name cle, COUNT(*) n FROM enrollments e
                   JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = e.school_id
                   JOIN levels lv ON lv.id = e.level_id AND lv.school_id = e.school_id
                  WHERE e.school_id = $1 GROUP BY 1`,
              )),
            ),
          );

          mesurer(
            'effectif par groupe',
            empreinte(
              (await l(
                `SELECT CONCAT(a.libelle, ' · ', g.nom) COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM etudiant_inscriptions i
                   JOIN annees_scolaires a ON a.id = i.annee_id
                   JOIN groupes g ON g.id = i.groupe_id
                  GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT y.label || ' · ' || g.name cle, COUNT(*) n FROM enrollments e
                   JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = e.school_id
                   JOIN groups g ON g.id = e.group_id AND g.school_id = e.school_id
                  WHERE e.school_id = $1 GROUP BY 1`,
              )),
            ),
          );

          mesurer(
            'inscriptions gratuites',
            String((await l('SELECT COUNT(*) n FROM etudiant_inscriptions WHERE gratuit = 1'))[0]!.n),
            String(
              (await t('SELECT COUNT(*) n FROM enrollments WHERE school_id = $1 AND is_free'))[0]!.n,
            ),
          );

          // ⚠ LA MESURE QUI DÉCIDE. Le reste dit que les lignes sont là ; celle-ci
          // dit que l'école réclamerait les mêmes montants. Un écart ici est un
          // défaut bloquant, pas une curiosité d'arrondi (règle 25).
          for (const [nom, colMy, colPg] of [
            ['frais mensuels', 'frais_mensuel', 'monthly_fee'],
            ['tarifs pleins', 'tarif_plein', 'full_rate'],
            ['frais d’inscription', 'frais_inscription', 'enrolment_fee'],
            ['frais de document', 'frais_document', 'document_fee'],
            ['frais de fourniture', 'frais_fourniture', 'supplies_fee'],
          ] as const) {
            mesurer(
              `somme des ${nom}`,
              sou((await l(`SELECT SUM(${colMy}) s FROM etudiant_inscriptions`))[0]!.s),
              sou((await t(`SELECT SUM(${colPg}) s FROM enrollments WHERE school_id = $1`))[0]!.s),
            );
          }

          // ⚠ LE PIÈGE DU FUSEAU. Une `datetime` MySQL lue dans le fuseau du poste
          // se décalerait, et une entrée du 1er octobre deviendrait le 30
          // septembre — donc un mois dû de plus ou de moins.
          mesurer(
            'dates d’entrée par mois',
            empreinte(
              (await l(
                `SELECT DATE_FORMAT(date_entree, '%Y-%m') cle, COUNT(*) n
                   FROM etudiant_inscriptions WHERE date_entree IS NOT NULL GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT to_char(entry_date, 'YYYY-MM') cle, COUNT(*) n FROM enrollments
                  WHERE school_id = $1 AND entry_date IS NOT NULL GROUP BY 1`,
              )),
            ),
          );

          mesurer(
            'dates de naissance par année',
            empreinte(
              (await l(
                `SELECT YEAR(date_naissance) cle, COUNT(*) n FROM etudiants
                  WHERE date_naissance IS NOT NULL GROUP BY cle`,
              )),
            ),
            empreinte(
              (await t(
                `SELECT EXTRACT(YEAR FROM date_of_birth)::int cle, COUNT(*) n FROM students
                  WHERE school_id = $1 AND date_of_birth IS NOT NULL GROUP BY 1`,
              )),
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
