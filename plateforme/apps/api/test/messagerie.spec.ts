import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CommsService } from '../src/comms/comms.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * MESSAGERIE PARENTS — targeting, from `messagerie.php`.
 *
 * Its subtitle IS the specification: "Cibler un parent par recherche OU diffuser
 * par niveau/groupe". One family, or a level, or a class — never a mixture.
 *
 * ⚠ WRITTEN FIRST BECAUSE THIS LEAVES THE BUILDING. A message sent to the wrong
 * set of families cannot be recalled, and the commonest way to get the set wrong
 * is to include people who have left.
 */

let owner: pg.Pool;
let comms: CommsService;
let enrollments: EnrollmentService;

let schoolId: string;
let thisYear: string;
let lastYear: string;
let levelId: string;
let otherLevelId: string;
let groupA: string;
let groupB: string;
let otherLevelGroup: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'msg' }, fn);
}

/** A family with one child, enrolled in a group for a given year. */
async function family(tag: string, groupId: string, yearId: string) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`msg.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;

  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Msg') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );

  if (yearId === thisYear) {
    await inTenant(() =>
      enrollments.enrol(
        { studentId: s.rows[0]!.id, academicYearId: yearId, groupId, entryDate: '2025-10-01' },
        ACTOR,
        DIRECTION,
      ),
    );
  } else {
    // A CLOSED year's enrolment is history, not an enrolment: the service
    // rightly refuses to write into a settled year, so the fixture inserts the
    // row the way the import would have.
    const level = await owner.query<{ level_id: string }>(
      'SELECT level_id FROM groups WHERE id = $1',
      [groupId],
    );
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 1000)`,
      [schoolId, s.rows[0]!.id, yearId, groupId, level.rows[0]!.level_id],
    );
  }
  return guardianId;
}

/** Who actually received the last message with this subject. */
async function recipientsOf(subject: string): Promise<string[]> {
  const { rows } = await owner.query<{ guardian_id: string }>(
    `SELECT DISTINCT guardian_id FROM messages WHERE subject = $1`,
    [subject],
  );
  return rows.map((r) => r.guardian_id).sort();
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('msg', 'Messagerie', 'MSG')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const years = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active'), ($1, '2024-2025', 2024, 'closed')
     RETURNING id, status`,
    [schoolId],
  );
  thisYear = years.rows.find((r) => r.status === 'active')!.id;
  lastYear = years.rows.find((r) => r.status === 'closed')!.id;

  const levels = await owner.query<{ id: string; name: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 1000, 'college'), ($1, '5eme', 1000, 'college')
     RETURNING id, name`,
    [schoolId],
  );
  levelId = levels.rows.find((r) => r.name === '6eme')!.id;
  otherLevelId = levels.rows.find((r) => r.name === '5eme')!.id;

  const groups = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES
       ($1, $2, '6eme A'), ($1, $2, '6eme B'), ($1, $3, '5eme A')
     RETURNING id, name`,
    [schoolId, levelId, otherLevelId],
  );
  groupA = groups.rows.find((r) => r.name === '6eme A')!.id;
  groupB = groups.rows.find((r) => r.name === '6eme B')!.id;
  otherLevelGroup = groups.rows.find((r) => r.name === '5eme A')!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('msg.admin@test', 'x', 'La direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  comms = moduleRef.get(CommsService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('targeting a group', () => {
  it('⚠ reaches this year’s families and NOT last year’s', async () => {
    // El Ourwa's own comment on this query: "sans filtre, un message adresse a
    // une classe partait aussi aux familles des eleves qui l'ont quittee
    // l'annee precedente."
    const current = await family('ga-now', groupA, thisYear);
    const departed = await family('ga-gone', groupA, lastYear);
    const elsewhere = await family('gb-now', groupB, thisYear);

    const subject = 'Réunion 6ème A';
    await inTenant(() =>
      comms.send(
        { subject, body: 'Mardi 18h.', groupId: groupA, academicYearId: thisYear },
        ACTOR,
      ),
    );

    const got = await recipientsOf(subject);
    expect(got).toContain(current);
    expect(got).not.toContain(departed);
    expect(got).not.toContain(elsewhere);
  });
});

describe('targeting a level', () => {
  it('reaches every group of the level, and no other level', async () => {
    const a = await family('lv-a', groupA, thisYear);
    const b = await family('lv-b', groupB, thisYear);
    const other = await family('lv-other', otherLevelGroup, thisYear);

    const subject = 'Info 6ème';
    await inTenant(() =>
      comms.send(
        { subject, body: 'Pour tout le niveau.', levelId, academicYearId: thisYear },
        ACTOR,
      ),
    );

    const got = await recipientsOf(subject);
    expect(got).toContain(a);
    expect(got).toContain(b);
    expect(got).not.toContain(other);
  });

  it('⚠ excludes families whose child left, as the group case does', async () => {
    // El Ourwa filters the GROUP query by year and the LEVEL query not at all —
    // reading the cached `etudiants.groupe_id` instead. That is the same defect
    // it had already diagnosed one branch above, so the filter is applied to
    // both here. Recorded in docs/DECISIONS.md.
    const staying = await family('lvl-now', groupA, thisYear);
    const departed = await family('lvl-gone', groupB, lastYear);

    const subject = 'Niveau — année en cours';
    await inTenant(() =>
      comms.send({ subject, body: 'x', levelId, academicYearId: thisYear }, ACTOR),
    );

    const got = await recipientsOf(subject);
    expect(got).toContain(staying);
    expect(got).not.toContain(departed);
  });
});

describe('one family', () => {
  it('reaches exactly that family', async () => {
    const one = await family('solo', groupA, thisYear);
    await family('not-solo', groupA, thisYear);

    const subject = 'Convocation individuelle';
    await inTenant(() => comms.send({ subject, body: 'Merci de passer.', guardianId: one }, ACTOR));

    expect(await recipientsOf(subject)).toEqual([one]);
  });
});

describe('what it refuses', () => {
  it('⚠ refuses to combine a named family with a broadcast', async () => {
    // Its own sentence: "Vous ne pouvez pas combiner « parent ciblé » et
    // « diffusion par niveau ». Choisissez UNE des deux options." Silently
    // preferring one of the two would send a class message to one family, or a
    // private one to a class.
    const one = await family('combo', groupA, thisYear);
    await expect(
      inTenant(() =>
        comms.send(
          { subject: 'Mélange', body: 'x', guardianId: one, levelId, academicYearId: thisYear },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/combiner|une des deux/i);
  });

  it('refuses a group that is not in the level named', async () => {
    await expect(
      inTenant(() =>
        comms.send(
          {
            subject: 'Incohérent',
            body: 'x',
            levelId,
            groupId: otherLevelGroup,
            academicYearId: thisYear,
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('says so when the criteria match nobody', async () => {
    const empty = await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme Z') RETURNING id`,
      [schoolId, levelId],
    );
    await expect(
      inTenant(() =>
        comms.send(
          { subject: 'Personne', body: 'x', groupId: empty.rows[0]!.id, academicYearId: thisYear },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/destinataire/i);
  });
});

describe('the message that was sent', () => {
  it('carries the sender’s name, not just their id', async () => {
    const one = await family('signe', groupA, thisYear);
    const subject = 'Signé';
    await inTenant(() => comms.send({ subject, body: 'x', guardianId: one }, ACTOR));

    const { rows } = await owner.query<{ sender_name: string }>(
      `SELECT sender_name FROM messages WHERE subject = $1`,
      [subject],
    );
    // A family reads "La direction", not a UUID.
    expect(rows[0]!.sender_name).toBe('La direction');
  });

  it('queues one email per family with an address, and no more', async () => {
    const withEmail = await family('mail-yes', groupA, thisYear);
    const subject = 'Avec adresse';
    await inTenant(() =>
      comms.send({ subject, body: 'x', groupId: groupA, academicYearId: thisYear }, ACTOR),
    );

    const { rows } = await owner.query<{ recipient: string }>(
      `SELECT recipient FROM outbound_mail WHERE subject = $1`,
      [subject],
    );
    const addresses = rows.map((r) => r.recipient);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses).toContain('msg.mail-yes@test');
    expect(withEmail).toBeTruthy();
  });
});
