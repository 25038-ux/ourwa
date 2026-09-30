import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequest } from '../auth/permissions.guard.js';
import { z } from 'zod';
import { DbService } from '../db/db.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { RequirePermission } from '../auth/permissions.guard.js';

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  // Cursor-based only. No OFFSET anywhere (standing rule 17 — 15 is
  // "write the test first", which sends a reader to the wrong page).
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('students')
export class StudentsController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * LA FICHE D'UN ÉLÈVE, MODIFIABLE DEPUIS LE DOSSIER DE LA FAMILLE — décision
   * du propriétaire (2026-09-20). El Ourwa ne modifiait ni le nom ni la date
   * de naissance d'un élève une fois inscrit ; une faute de frappe à
   * l'admission restait sur chaque bulletin. Ce qui se corrige ici : prénom,
   * nom, sexe, date et lieu de naissance, NNI, RIM. Pas le groupe ni le tarif
   * (ils ont leurs écrans), pas la famille (c'est un rattachement, pas une
   * correction).
   */
  @Post(':id')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire')
  async modifier(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const studentId = z.string().uuid().parse(id);
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        sex: z.enum(['M', 'F']).nullable().optional(),
        dateOfBirth: z.string().date('Date de naissance invalide.').nullable().optional(),
        placeOfBirth: z.string().trim().max(120).nullable().optional(),
        nationalId: z.string().trim().max(40).optional(),
        rim: z.string().trim().max(40).optional(),
      })
      .parse(raw ?? {});
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: avant } = await tx.query<{ first_name: string; last_name: string; sex: string | null; date_of_birth: string | null; place_of_birth: string | null; national_id: string | null; rim: string | null }>(
        'SELECT first_name, last_name, sex, date_of_birth::text, place_of_birth, national_id, rim FROM students WHERE id = $1',
        [studentId],
      );
      if (!avant[0]) throw new NotFoundException('Élève introuvable.');
      const rim = body.rim?.trim() || avant[0].rim;
      const nni = body.nationalId?.trim() || avant[0].national_id;
      if (rim !== avant[0].rim) {
        const { rows: pris } = await tx.query('SELECT 1 FROM students WHERE rim = $1 AND id <> $2', [rim, studentId]);
        if (pris.length > 0) throw new BadRequestException('Ce RIM est déjà celui d’un autre élève de l’école.');
      }
      // Le NNI, facultatif à l'inscription (0044), se renseigne souvent ici plus
      // tard : un doublon a son message, pas une erreur 500 de l'unique.
      if (nni !== avant[0].national_id) {
        const { rows: pris } = await tx.query('SELECT 1 FROM students WHERE national_id = $1 AND id <> $2', [nni, studentId]);
        if (pris.length > 0) throw new BadRequestException('Ce NNI est déjà celui d’un autre élève de l’école.');
      }
      await tx.query(
        `UPDATE students SET first_name = $2, last_name = $3, sex = $4, date_of_birth = $5, place_of_birth = $6,
                             national_id = $7, rim = $8
          WHERE id = $1`,
        // Un champ ABSENT garde sa valeur ; un champ vide (null) l'efface.
        [
          studentId, body.firstName, body.lastName,
          body.sex === undefined ? avant[0].sex : body.sex,
          body.dateOfBirth === undefined ? avant[0].date_of_birth : body.dateOfBirth,
          body.placeOfBirth === undefined ? avant[0].place_of_birth : body.placeOfBirth,
          nni, rim,
        ],
      );
      await this.audit.record(
        {
          actorId: request.auth!.userId,
          schoolId,
          action: 'student_identity_updated',
          entity: 'student',
          entityId: studentId,
          before: avant[0],
          after: {
            first_name: body.firstName, last_name: body.lastName,
            sex: body.sex === undefined ? avant[0].sex : body.sex,
            date_of_birth: body.dateOfBirth === undefined ? avant[0].date_of_birth : body.dateOfBirth,
            place_of_birth: body.placeOfBirth === undefined ? avant[0].place_of_birth : body.placeOfBirth,
            national_id: nni, rim,
          },
        },
        tx,
      );
      return { updated: true };
    });
  }

  /** La fiche d'identité d'un élève, telle qu'on la corrige. */
  @Get(':id/identite')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'finance.consulter', 'finance.encaisser', 'recherche.globale')
  async identite(@Param('id') id: string) {
    const studentId = z.string().uuid().parse(id);
    const { rows } = await this.db.query((tx) =>
      tx.query<{ id: string; first_name: string; last_name: string; sex: string | null; date_of_birth: string | null; place_of_birth: string | null; national_id: string; rim: string; matricule: string | null }>(
        'SELECT id, first_name, last_name, sex, date_of_birth::text, place_of_birth, national_id, rim, matricule FROM students WHERE id = $1',
        [studentId],
      ),
    );
    if (!rows[0]) throw new NotFoundException('Élève introuvable.');
    return rows[0];
  }

  /**
   * ⚠ THIS HAD NO PERMISSION AT ALL, AND THE `parent` ROLE HOLDS NONE — so "no
   * decorator" meant "anybody with a token", and a parent's token is the
   * easiest in the building to obtain. Proved against the running system: a
   * signed-in parent could read every child in the school with their name, sex,
   * place of birth and class.
   *
   * RLS was doing its job the whole time; it keeps other SCHOOLS out. This is
   * the other boundary — what a role INSIDE a school may see.
   *
   * The list is an ALLOW-list of what its real callers hold. A role holding
   * none of them — parent, and the absence collector, whose whole job is the
   * register they reach by its own route — passes none.
   */
  @Get()
  @RequirePermission(
    'scolarite.groupes', 'scolarite.inscrire', 'scolarite.reinscrire',
    'recherche.globale', 'notes.consulter', 'finance.consulter', 'exercices.envoyer',
  )
  async list(@Query() rawQuery: unknown) {
    const { q, cursor, limit } = listQuery.parse(rawQuery ?? {});
    const { slug } = currentTenant();

    // Note the deliberate absence of `school_id` in the WHERE clause. Isolation
    // is the database's job, not the query author's — if this returned another
    // school's rows, the policy would be broken and the test suite would say so.
    const rows = await this.db.query(async (tx) => {
      const params: unknown[] = [];
      let sql = `
        SELECT s.id, s.first_name, s.last_name, s.sex, s.address,
               g.name AS group_name, l.name AS level
          FROM students s
          -- L'inscription de l'ANNÉE ACTIVE seulement : jointe sur toutes les
          -- années, un élève réinscrit sortait en double (3 506 inscriptions
          -- pour 2 153 élèves) et le curseur sautait ses copies en bord de page.
          LEFT JOIN enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
                 AND e.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)
          LEFT JOIN groups g ON g.id = e.group_id
          LEFT JOIN levels l ON l.id = e.level_id
         WHERE true`;
      if (q) {
        params.push(`%${q}%`);
        sql += ` AND (s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`;
      }
      if (cursor) {
        params.push(cursor);
        sql += ` AND s.id > $${params.length}`;
      }
      params.push(limit + 1);
      sql += ` ORDER BY s.id LIMIT $${params.length}`;
      const result = await tx.query(sql, params);
      return result.rows as Array<Record<string, unknown>>;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      school: slug,
      students: page,
      nextCursor: hasMore ? (page[page.length - 1]!['id'] as string) : null,
    };
  }

  /**
   * RECHERCHER UN CORRESPONDANT — `inscrire_etudiant.php`'s `ajax_search_parent`.
   *
   * The enrolment screen needs the family before it can attach the child, and a
   * school of 1 372 families cannot be a <select>. This is the search behind it.
   *
   * ⚠ TWO CHARACTERS MINIMUM, and its own reason: below that "la recherche
   * ramène la moitié de l'école et n'aide personne."
   *
   * ⚠ THE PHONE CLAUSE ONLY APPLIES WHEN THE INPUT CONTAINS DIGITS. This is a
   * bug El Ourwa hit and fixed, and its comment names the symptom: stripping a
   * letters-only query to digits leaves an empty string, `LIKE '%%'` then
   * matches every parent, and "la page affichait les 20 mêmes quelle que soit
   * la saisie." A search that returns the same twenty names for every query
   * looks like it is working.
   *
   * The stored number is compared with its spaces, dashes and plus signs
   * removed, because nobody types a number the way it was saved.
   */
  /**
   * ⚠ THE FAMILY DIRECTORY, AND IT WAS OPEN TO EVERYONE WITH A TOKEN. Two
   * characters returned twenty families with their full names and TELEPHONE
   * NUMBERS; a parent, or a teacher, could walk the alphabet and have all 1 372.
   *
   * Its callers are the admission form's parent search, the messagerie, and the
   * till. Those permissions and no others — a teacher's own students live at
   * `/teacher/my-students`, scoped by the token, which is a different thing
   * from the school's parent directory.
   */
  @Get('guardians/search')
  @RequirePermission(
    'scolarite.inscrire', 'scolarite.reinscrire', 'messagerie.envoyer',
    'finance.consulter', 'finance.encaisser', 'recherche.globale', 'comptes.parents',
  )
  async searchGuardians(@Query('q') rawQ = '', @Query('actifs') actifs?: string, @Query('limit') rawLimit?: string) {
    const q = String(rawQ).trim();
    if (q.length < 2) return [];
    // `messagerie.php` : `WHERE actif = 1 … LIMIT 30`.
    const seulementActifs = actifs === '1';
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 100);

    const digits = q.replace(/\D/g, '');
    // `%` and `_` are LIKE wildcards; a family whose name contains one would
    // otherwise search for something else entirely.
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        full_name: string;
        phone: string | null;
        children: string;
      }>(
        `SELECT u.id, u.full_name, u.phone,
                (SELECT count(*)::text FROM students s WHERE s.guardian_id = u.id) AS children
           FROM users u
          WHERE EXISTS (SELECT 1 FROM students s WHERE s.guardian_id = u.id)
            AND (NOT $3::boolean OR u.active)
            AND (
              u.full_name ILIKE $1 ESCAPE '\\'
              OR ($2 <> '' AND replace(replace(replace(
                    coalesce(u.phone, ''), ' ', ''), '-', ''), '+', '') LIKE '%' || $2 || '%')
            )
          ORDER BY u.full_name
          LIMIT $4`,
        [pattern, digits, seulementActifs, limit],
      );

      return rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        phone: r.phone,
        children: Number(r.children),
      }));
    });
  }

  /** The headcount. Same allow-list as the roster it counts. */
  @Get('count')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.inscrire', 'scolarite.reinscrire',
    'recherche.globale', 'notes.consulter', 'finance.consulter',
    'statistiques.consulter', 'finance.rapport',
  )
  async count() {
    const { slug } = currentTenant();
    const total = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM students');
      return Number(rows[0]!.n);
    });
    return { school: slug, total };
  }
}
