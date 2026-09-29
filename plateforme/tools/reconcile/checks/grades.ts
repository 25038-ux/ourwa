import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Check, CheckResult } from '../types.js';
import {
  clesDivergentes,
  condense,
  empreinte,
  premierEcart,
  sou,
  MYSQL,
} from './commun.js';

/**
 * LES NOTES, LES ENSEIGNEMENTS ET LA FORMULE DU BULLETIN, DES DEUX CÔTÉS.
 *
 * `checks/bulletins.ts` prouve que notre ARITHMÉTIQUE rend les chiffres d'El
 * Ourwa : il lui donne les mêmes notes en entrée et compare les moyennes. Mais
 * il les lit dans un extrait JSON, pas dans notre base. Il ne dit donc rien de
 * la question posée ici : **les 139 457 notes sont-elles arrivées, et les
 * bonnes ?**
 *
 * Les deux ensemble font la preuve complète. Séparément, chacun laisse un trou :
 * une arithmétique juste sur des notes fausses rend des bulletins faux, et des
 * notes justes passées dans une mauvaise formule aussi.
 *
 * ⚠ LA MESURE QUI COMPTE LE PLUS EST « notes par élève, matière et trimestre ».
 * « 139 457 des deux côtés » ne prouve rien : deux notes interverties entre deux
 * élèves laissent le total intact et changent deux bulletins. L'empreinte les
 * verrait.
 *
 * ⚠ ET LE MARQUEUR D'ABSENCE SE COMPTE À PART. `valeur = -1` est un MARQUEUR, pas
 * une note (règle 11). Il doit arriver ici INCHANGÉ — c'est le calcul qui
 * l'exclut, pas l'import — donc son décompte est une mesure à lui, et la somme
 * des notes est mesurée avec ET sans lui. Si l'import se mettait un jour à le
 * filtrer, la première somme bougerait et la seconde non.
 */

export function gradesCheck(slug: string): Check {
  return {
    name: 'notes',
    group: 'grades',
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

      /**
       * ⚠ LA MÊME MESURE, MAIS DONT LES CLÉS NE SORTENT PAS. Le rapport daté est
       * versionné et `run.ts` promet qu'il ne contient « aucun nom, aucun
       * identifiant » ; une empreinte de `100:126:1=2` porte des identifiants
       * d'enfants. On compare donc deux condensés — ils diffèrent dès qu'une
       * seule clé diffère — et les clés fautives partent dans `sample`, que seul
       * `--verbose` imprime, et jamais sur le disque.
       */
      const mesurerOpaque = (name: string, legacy: string, current: string) => {
        const match = legacy === current;
        const ecarts = match ? [] : clesDivergentes(legacy, current);
        resultats.push({
          name,
          legacy: condense(legacy),
          current: condense(current),
          match,
          delta: match ? undefined : `${ecarts.length}+ clé(s) divergente(s) — --verbose`,
          sample: ecarts.length ? ecarts : undefined,
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

        // ⚠ Sans locataire, RLS rend zéro sans erreur, et « 139457 contre 0 »
        // ressemblerait à un import raté (règle 2 : jamais de `SET` nu).
        const client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_school_id', $1, true)", [ecole]);
        const t = async (sql: string) => {
          const { rows } = await client.query(sql, [ecole]);
          return rows as Record<string, unknown>[];
        };

        try {
          // ── Qui enseigne quoi ───────────────────────────────────────────
          mesurer(
            'professeurs',
            String((await l('SELECT COUNT(*) n FROM professeurs'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM teachers WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'comptes du personnel',
            String((await l('SELECT COUNT(*) n FROM utilisateurs'))[0]!.n),
            String(
              (
                await t(
                  `SELECT COUNT(DISTINCT usr.user_id) n FROM user_school_roles usr
                     JOIN roles r ON r.id = usr.role_id
                    WHERE usr.school_id = $1 AND r.code <> 'parent'`,
                )
              )[0]!.n,
            ),
          );

          // Un rôle perdu à la reprise, c'est un écran auquel quelqu'un n'a plus
          // accès le lundi de la bascule.
          mesurer(
            'rôles du personnel',
            empreinte(
              await l(
                `SELECT r.code COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM utilisateur_roles ur JOIN roles r ON r.id = ur.role_id
                  GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT r.code cle, COUNT(*) n FROM user_school_roles usr
                   JOIN roles r ON r.id = usr.role_id
                  WHERE usr.school_id = $1 AND r.code <> 'parent' GROUP BY r.code`,
              ),
            ),
          );

          mesurer(
            'enseignements',
            String((await l('SELECT COUNT(*) n FROM enseignements'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM teachings WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'enseignements par année',
            empreinte(
              await l(
                `SELECT a.libelle COLLATE utf8mb4_bin cle, COUNT(*) n FROM enseignements e
                   JOIN annees_scolaires a ON a.id = e.annee_id GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT y.label cle, COUNT(*) n FROM teachings tg
                   JOIN academic_years y ON y.id = tg.academic_year_id AND y.school_id = tg.school_id
                  WHERE tg.school_id = $1 GROUP BY y.label`,
              ),
            ),
          );

          mesurer(
            'heures par semaine',
            sou((await l('SELECT SUM(heures_par_semaine) s FROM enseignements'))[0]!.s),
            sou((await t('SELECT SUM(hours_per_week) s FROM teachings WHERE school_id = $1'))[0]!.s),
          );

          // ── La formule du bulletin ──────────────────────────────────────
          // ⚠ Une formule fausse ne se voit pas : elle rend un nombre plausible.
          // C'est exactement ce que dit la migration 0016.
          mesurer(
            'formules du bulletin',
            empreinte(
              await l(
                `SELECT CONCAT(n.nom, ' T', f.trimestre) COLLATE utf8mb4_bin cle,
                        CONCAT(f.coef_devoirs, '/', f.coef_examen, '/', f.diviseur) n
                   FROM bulletin_formules f JOIN niveaux n ON n.id = f.niveau_id`,
              ),
            ),
            empreinte(
              await t(
                `SELECT lv.name || ' T' || f.term cle,
                        f.coursework_weight || '/' || f.exam_weight || '/' || f.divisor n
                   FROM bulletin_formulas f
                   JOIN levels lv ON lv.id = f.level_id AND lv.school_id = f.school_id
                  WHERE f.school_id = $1`,
              ),
            ),
          );

          // ── Les notes ───────────────────────────────────────────────────
          mesurer(
            'notes',
            String((await l('SELECT COUNT(*) n FROM notes'))[0]!.n),
            String((await t('SELECT COUNT(*) n FROM grades WHERE school_id = $1'))[0]!.n),
          );

          mesurer(
            'notes par année et trimestre',
            empreinte(
              await l(
                `SELECT CONCAT(a.libelle, ' T', n.trimestre) COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM notes n JOIN annees_scolaires a ON a.id = n.annee_id GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT y.label || ' T' || g.term cle, COUNT(*) n FROM grades g
                   JOIN academic_years y ON y.id = g.academic_year_id AND y.school_id = g.school_id
                  WHERE g.school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          mesurer(
            'notes par nature',
            empreinte(
              (
                await l("SELECT type_note cle, COUNT(*) n FROM notes GROUP BY type_note")
              ).map((r) => ({ cle: r.cle === 'examen' ? 'exam' : 'coursework', n: r.n })),
            ),
            empreinte(
              await t('SELECT kind cle, COUNT(*) n FROM grades WHERE school_id = $1 GROUP BY kind'),
            ),
          );

          // ⚠ LA MESURE FINE. Deux notes interverties entre deux élèves laissent
          // tous les totaux ci-dessus intacts et changent deux bulletins. Celle-ci
          // descend jusqu'au triplet (élève, matière, trimestre) — 139 457 notes
          // réparties sur des dizaines de milliers de clés.
          mesurerOpaque(
            'notes par élève, matière et trimestre',
            empreinte(
              await l(
                `SELECT CONCAT(n.etudiant_id, ':', e.matiere_id, ':', n.trimestre)
                          COLLATE utf8mb4_bin cle,
                        COUNT(*) n
                   FROM notes n JOIN enseignements e ON e.id = n.enseignement_id
                  GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT s.legacy_id || ':' || sb.legacy_id || ':' || g.term cle, COUNT(*) n
                   FROM grades g
                   JOIN students s  ON s.id = g.student_id  AND s.school_id = g.school_id
                   JOIN teachings tg ON tg.id = g.teaching_id AND tg.school_id = g.school_id
                   JOIN subjects sb ON sb.id = tg.subject_id AND sb.school_id = g.school_id
                  WHERE g.school_id = $1 GROUP BY 1`,
              ),
            ),
          );

          // ⚠ Le marqueur d'absence, compté à part et repris INCHANGÉ (règle 11).
          mesurer(
            'marqueurs d’absence',
            String((await l('SELECT COUNT(*) n FROM notes WHERE valeur = -1'))[0]!.n),
            String(
              (await t('SELECT COUNT(*) n FROM grades WHERE school_id = $1 AND score = -1'))[0]!.n,
            ),
          );

          // Deux sommes : avec le marqueur, puis sans lui. Si l'import se mettait
          // à le filtrer, la première bougerait et la seconde non.
          mesurer(
            'somme des notes, marqueur compris',
            sou((await l('SELECT SUM(valeur) s FROM notes'))[0]!.s),
            sou((await t('SELECT SUM(score) s FROM grades WHERE school_id = $1'))[0]!.s),
          );

          mesurer(
            'somme des notes réelles',
            sou((await l('SELECT SUM(valeur) s FROM notes WHERE valeur <> -1'))[0]!.s),
            sou(
              (await t('SELECT SUM(score) s FROM grades WHERE school_id = $1 AND score <> -1'))[0]!
                .s,
            ),
          );

          // ⚠ Le piège du fuseau, ici sur la date de saisie d'une note.
          mesurer(
            'saisies par mois',
            empreinte(
              await l(
                `SELECT DATE_FORMAT(date_saisie, '%Y-%m') COLLATE utf8mb4_bin cle, COUNT(*) n
                   FROM notes WHERE date_saisie IS NOT NULL GROUP BY cle`,
              ),
            ),
            empreinte(
              await t(
                `SELECT to_char(recorded_at AT TIME ZONE 'Africa/Nouakchott', 'YYYY-MM') cle,
                        COUNT(*) n
                   FROM grades WHERE school_id = $1 GROUP BY 1`,
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
