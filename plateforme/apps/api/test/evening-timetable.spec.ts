import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EveningService } from '../src/evening/evening.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA GRILLE DES CRÉNEAUX — `cours_du_soir.php`, `placer_creneau` et
 * `effacer_creneau`.
 *
 * ⚠ UN CRÉNEAU SE POSE SUR UNE MATIÈRE, et la matière doit exister DANS CE
 * GROUPE : "Cette matière n'existe pas dans ce groupe : créez-la d'abord en
 * assignant un professeur." Une matière naît d'une assignation, jamais d'une
 * saisie libre — sans quoi la grille afficherait un cours que personne ne donne.
 *
 * ⚠ L'ENSEIGNANT EST FACULTATIF — « Aucun / à définir plus tard » — mais s'il
 * est donné il doit appartenir à ce groupe : "Cet enseignant n'est pas assigné
 * à ce groupe."
 *
 * ⚠ ET POSER UN CRÉNEAU SUR UNE CASE OCCUPÉE LA REMPLACE. Son action fait
 * DELETE puis INSERT sur (groupe, jour, créneau) : une classe n'est pas à deux
 * endroits à la fois.
 */

let owner: pg.Pool;
let evening: EveningService;

let schoolId: string;
let groupId: string;
let otherGroupId: string;
let teachingMaths: string;
let teachingPhysique: string;
let teachingAutreGroupe: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'grille' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('grille', 'Grille', 'GRI')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  await owner.query(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active')`,
    [schoolId],
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('grille.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const gs = await owner.query<{ id: string; name: string }>(
    `INSERT INTO evening_groups (school_id, name, monthly_rate) VALUES
       ($1, 'Soutien Bac', 5000), ($1, 'Langues', 4000)
     RETURNING id, name`,
    [schoolId],
  );
  groupId = gs.rows.find((r) => r.name === 'Soutien Bac')!.id;
  otherGroupId = gs.rows.find((r) => r.name === 'Langues')!.id;

  const profs = await owner.query<{ id: string; first_name: string }>(
    `INSERT INTO evening_teachers (school_id, first_name, last_name) VALUES
       ($1, 'Sidi', 'Ould Ahmed'), ($1, 'Fatimetou', 'Mint Sidi')
     RETURNING id, first_name`,
    [schoolId],
  );

  const t = await owner.query<{ id: string; subject: string }>(
    `INSERT INTO evening_teachings
       (school_id, evening_group_id, evening_teacher_id, subject, pay_kind, hourly_rate)
     VALUES ($1, $2, $3, 'Mathématiques', 'hourly', 500),
            ($1, $2, $4, 'Physique', 'hourly', 500)
     RETURNING id, subject`,
    [schoolId, groupId, profs.rows[0]!.id, profs.rows[1]!.id],
  );
  teachingMaths = t.rows.find((r) => r.subject === 'Mathématiques')!.id;
  teachingPhysique = t.rows.find((r) => r.subject === 'Physique')!.id;

  const other = await owner.query<{ id: string }>(
    `INSERT INTO evening_teachings
       (school_id, evening_group_id, evening_teacher_id, subject, pay_kind, hourly_rate)
     VALUES ($1, $2, $3, 'Anglais', 'hourly', 500) RETURNING id`,
    [schoolId, otherGroupId, profs.rows[0]!.id],
  );
  teachingAutreGroupe = other.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  evening = moduleRef.get(EveningService);
});

afterAll(async () => {
  await owner?.end();
});

describe('poser un créneau', () => {
  it('place la matière et son enseignant dans la case', async () => {
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: groupId, dayOfWeek: 1, slot: 3, subject: 'Mathématiques', eveningTeachingId: teachingMaths },
        ACTOR,
      ),
    );

    const grid = await inTenant(() => evening.timetable(groupId));
    const cell = grid.find((c) => c.dayOfWeek === 1 && c.slot === 3)!;
    expect(cell.subject).toBe('Mathématiques');
    expect(cell.teacherName).toBe('Sidi Ould Ahmed');
  });

  it('⚠ accepte un créneau sans enseignant — « à définir plus tard »', async () => {
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: groupId, dayOfWeek: 2, slot: 1, subject: 'Physique' },
        ACTOR,
      ),
    );
    const grid = await inTenant(() => evening.timetable(groupId));
    const cell = grid.find((c) => c.dayOfWeek === 2 && c.slot === 1)!;
    expect(cell.subject).toBe('Physique');
    expect(cell.teacherName).toBeNull();
  });

  it('⚠ refuse une matière qui n’existe pas dans ce groupe', async () => {
    await expect(
      inTenant(() =>
        evening.placeSlot(
          { eveningGroupId: groupId, dayOfWeek: 3, slot: 1, subject: 'Anglais' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/n’existe pas dans ce groupe|n'existe pas dans ce groupe/i);
  });

  it('⚠ refuse un enseignant assigné à un autre groupe', async () => {
    await expect(
      inTenant(() =>
        evening.placeSlot(
          {
            eveningGroupId: groupId,
            dayOfWeek: 3,
            slot: 2,
            subject: 'Mathématiques',
            eveningTeachingId: teachingAutreGroupe,
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/pas assigné à ce groupe/i);
  });

  it('reprend la matière de l’assignation quand aucune n’est saisie', async () => {
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: groupId, dayOfWeek: 4, slot: 2, eveningTeachingId: teachingPhysique },
        ACTOR,
      ),
    );
    const grid = await inTenant(() => evening.timetable(groupId));
    expect(grid.find((c) => c.dayOfWeek === 4 && c.slot === 2)!.subject).toBe('Physique');
  });

  it('refuse une case sans matière ni enseignant', async () => {
    await expect(
      inTenant(() => evening.placeSlot({ eveningGroupId: groupId, dayOfWeek: 5, slot: 1 }, ACTOR)),
    ).rejects.toThrow(/matière|enseignant/i);
  });

  it('refuse un jour ou un créneau hors grille', async () => {
    for (const bad of [
      { dayOfWeek: 0, slot: 1 },
      { dayOfWeek: 8, slot: 1 },
      { dayOfWeek: 1, slot: 0 },
      { dayOfWeek: 1, slot: 8 },
    ]) {
      await expect(
        inTenant(() =>
          evening.placeSlot({ eveningGroupId: groupId, subject: 'Physique', ...bad }, ACTOR),
        ),
      ).rejects.toThrow();
    }
  });

  it('⚠ une case occupée est remplacée, jamais doublée', async () => {
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: groupId, dayOfWeek: 1, slot: 3, subject: 'Physique', eveningTeachingId: teachingPhysique },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM evening_timetable_slots
        WHERE evening_group_id = $1 AND day_of_week = 1 AND slot = 3`,
      [groupId],
    );
    expect(rows[0]!.n).toBe('1');

    const grid = await inTenant(() => evening.timetable(groupId));
    expect(grid.find((c) => c.dayOfWeek === 1 && c.slot === 3)!.subject).toBe('Physique');
  });
});

describe('effacer un créneau', () => {
  it('libère la case et laisse les autres intactes', async () => {
    const avant = await inTenant(() => evening.timetable(groupId));
    await inTenant(() => evening.clearSlot(groupId, 2, 1, ACTOR));
    const apres = await inTenant(() => evening.timetable(groupId));

    expect(apres.find((c) => c.dayOfWeek === 2 && c.slot === 1)).toBeUndefined();
    expect(apres).toHaveLength(avant.length - 1);
  });

  it('effacer une case vide ne casse rien', async () => {
    await expect(inTenant(() => evening.clearSlot(groupId, 7, 7, ACTOR))).resolves.toBeDefined();
  });
});

describe('retirer l’assignation d’un professeur', () => {
  it('⚠ laisse le cours en place, sans nom — jamais un trou dans la grille', async () => {
    // Sa grille affiche un tiret quand la case n'a pas d'enseignant. Effacer
    // l'assignation ne doit pas effacer le cours : c'est le professeur qui
    // s'en va, pas la matière.
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: groupId, dayOfWeek: 6, slot: 4, subject: 'Mathématiques', eveningTeachingId: teachingMaths },
        ACTOR,
      ),
    );
    await inTenant(() => evening.removeTeaching(teachingMaths, ACTOR));

    const grid = await inTenant(() => evening.timetable(groupId));
    const cell = grid.find((c) => c.dayOfWeek === 6 && c.slot === 4)!;
    expect(cell.subject).toBe('Mathématiques');
    expect(cell.teacherName).toBeNull();
  });
});

describe('l’isolation tient', () => {
  it('la grille d’un groupe ne montre pas celle d’un autre', async () => {
    await inTenant(() =>
      evening.placeSlot(
        { eveningGroupId: otherGroupId, dayOfWeek: 1, slot: 1, subject: 'Anglais' },
        ACTOR,
      ),
    );
    const grid = await inTenant(() => evening.timetable(groupId));
    expect(grid.every((c) => c.subject !== 'Anglais')).toBe(true);
  });
});
