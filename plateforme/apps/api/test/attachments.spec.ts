import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { UploadRejected, safeDisplayName } from '../src/attachments/storage.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Homework attachments — El Ourwa v16 `includes/upload.php`.
 *
 * Its defence in depth is ported literally, and these tests are the reason to
 * trust that: each layer is shown refusing something the others would let past.
 */

let owner: pg.Pool;
let attachments: AttachmentsService;

let schoolId: string;
let homeworkId: string;
let teacherUser: string;
let guardianUser: string;
let strangerUser: string;
let ACTOR: string;
let uploadDir: string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 3)]);

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'att' }, fn);
}

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), 'elourwa-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;

  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('att', 'Attachments', 'ATT') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
    [schoolId],
  );
  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 10000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  const subject = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('att.admin@test', 'x', 'Directeur'),
       ('att.teacher@test', 'x', 'Prof'),
       ('att.parent@test', 'x', 'Parent'),
       ('att.stranger@test', 'x', 'Autre Parent')
     RETURNING id, email`,
  );
  ACTOR = users.rows.find((r) => r.email === 'att.admin@test')!.id;
  teacherUser = users.rows.find((r) => r.email === 'att.teacher@test')!.id;
  guardianUser = users.rows.find((r) => r.email === 'att.parent@test')!.id;
  strangerUser = users.rows.find((r) => r.email === 'att.stranger@test')!.id;

  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, user_id, first_name, last_name)
     VALUES ($1, $2, 'Le', 'Prof') RETURNING id`,
    [schoolId, teacherUser],
  );
  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, year.rows[0]!.id, teacher.rows[0]!.id, group.rows[0]!.id, subject.rows[0]!.id],
  );

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-AT', 'NID-AT', 'Enfant', 'Attache') RETURNING id`,
    [schoolId, guardianUser],
  );
  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000)`,
    [schoolId, student.rows[0]!.id, year.rows[0]!.id, group.rows[0]!.id, level.rows[0]!.id],
  );

  const homework = await owner.query<{ id: string }>(
    `INSERT INTO homework (school_id, teaching_id, title, body)
     VALUES ($1, $2, 'Exercices 1 à 10', 'Pour lundi') RETURNING id`,
    [schoolId, teaching.rows[0]!.id],
  );
  homeworkId = homework.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  attachments = moduleRef.get(AttachmentsService);
});

afterAll(async () => {
  await owner?.end();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe('what the validator refuses', () => {
  it('⚠ refuses a PHP script wearing a .png extension', async () => {
    // The whole reason the type is read from the BYTES. A browser can claim any
    // Content-Type, and an extension is only a string.
    await expect(
      inTenant(() =>
        attachments.attach(
          homeworkId,
          { buffer: Buffer.from('<?php system($_GET["c"]); ?>'), filename: 'photo.png' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(UploadRejected);
  });

  it('⚠ refuses a real PNG whose extension lies about it', async () => {
    // Genuine image bytes, but named .pdf. Content and extension must agree, or
    // a file gets handed to whatever opens the name rather than the content.
    await expect(
      inTenant(() =>
        attachments.attach(homeworkId, { buffer: PNG, filename: 'notes.pdf' }, ACTOR),
      ),
    ).rejects.toThrow(/extension/i);
  });

  it('refuses an empty file', async () => {
    await expect(
      inTenant(() =>
        attachments.attach(homeworkId, { buffer: Buffer.alloc(0), filename: 'x.png' }, ACTOR),
      ),
    ).rejects.toThrow(/vide/i);
  });

  it('refuses anything over the ceiling', async () => {
    await expect(
      inTenant(() =>
        attachments.attach(
          homeworkId,
          { buffer: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]), filename: 'big.png' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/volumineux/i);
  });

  it('⚠ refuses a RIFF file that is not actually WebP', async () => {
    // A .wav also begins with RIFF. Without the second check at offset 8 it
    // would pass as an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVE'),
      Buffer.alloc(32),
    ]);
    await expect(
      inTenant(() => attachments.attach(homeworkId, { buffer: wav, filename: 'a.webp' }, ACTOR)),
    ).rejects.toThrow(UploadRejected);
  });

  it('refuses an unknown homework before it writes anything to disk', async () => {
    await expect(
      inTenant(() =>
        attachments.attach(
          '00000000-0000-7000-8000-000000000000',
          { buffer: PNG, filename: 'x.png' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/Exercice introuvable/i);
  });
});

describe('the display name', () => {
  it('keeps something readable but strips anything path-shaped', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('etcpasswd');
    expect(safeDisplayName('Devoir de maths.pdf')).toBe('Devoir de maths.pdf');
    expect(safeDisplayName('   ')).toBe('fichier');
  });
});

describe('storing and reading back', () => {
  let attachmentId: string;

  it('accepts a genuine PDF', async () => {
    const saved = await inTenant(() =>
      attachments.attach(homeworkId, { buffer: PDF, filename: 'sujet.pdf' }, ACTOR),
    );
    attachmentId = saved.id;
    expect(saved.mime).toBe('application/pdf');
    expect(saved.displayName).toBe('sujet.pdf');
  });

  it('⚠ stores it under a random name, never the one supplied', async () => {
    const { rows } = await owner.query<{ stored_name: string }>(
      'SELECT stored_name FROM attachments WHERE id = $1',
      [attachmentId],
    );
    expect(rows[0]!.stored_name).toMatch(/^[0-9a-f]{32}\.pdf$/);
    expect(rows[0]!.stored_name).not.toContain('sujet');
  });

  it('gives it to a member of staff', async () => {
    const file = await inTenant(() =>
      attachments.download(attachmentId, ACTOR, ['exercices.envoyer']),
    );
    expect(file.buffer.equals(PDF)).toBe(true);
    expect(file.mime).toBe('application/pdf');
  });

  it('gives it to the teacher whose class it is', async () => {
    const file = await inTenant(() => attachments.download(attachmentId, teacherUser, []));
    expect(file.buffer.length).toBe(PDF.length);
  });

  it('gives it to a parent with a child in that class', async () => {
    const file = await inTenant(() => attachments.download(attachmentId, guardianUser, []));
    expect(file.buffer.length).toBe(PDF.length);
  });

  it('⚠ REFUSES a signed-in parent from another family', async () => {
    // This is what serving through the API buys over El Ourwa, which hands the
    // file to anyone holding the URL because Apache serves it unauthenticated.
    await expect(
      inTenant(() => attachments.download(attachmentId, strangerUser, [])),
    ).rejects.toThrow(/n’appartient pas à votre classe/i);
  });

  it('⚠ reports a restore as INCOMPLETE when the file is gone', async () => {
    // A database-only restore leaves every attachment a broken link and nothing
    // says so until a parent taps one. This is the check that says so.
    const before = await inTenant(() => attachments.integrity());
    expect(before.complete).toBe(true);
    expect(before.missingFiles).toHaveLength(0);

    const { rows } = await owner.query<{ stored_name: string }>(
      'SELECT stored_name FROM attachments WHERE id = $1',
      [attachmentId],
    );
    rmSync(join(uploadDir, schoolId, rows[0]!.stored_name));

    const after = await inTenant(() => attachments.integrity());
    expect(after.complete).toBe(false);
    expect(after.missingFiles).toHaveLength(1);
    expect(after.missingFiles[0]!.displayName).toBe('sujet.pdf');
  });

  it('reports a file with no row, which wastes space but loses nothing', async () => {
    writeFileSync(join(uploadDir, schoolId, 'a'.repeat(32) + '.pdf'), 'orphan');
    const report = await inTenant(() => attachments.integrity());
    expect(report.orphanFiles).toContain('a'.repeat(32) + '.pdf');
  });

  it('lists what is attached to the exercise', async () => {
    const list = await inTenant(() => attachments.forHomework(homeworkId));
    expect(list).toHaveLength(1);
    expect(list[0]!.display_name).toBe('sujet.pdf');
  });
});

describe('les documents de bureau (04/10/2026)', () => {
  it('accepte une fiche Word : « envoyer exercice : you can’t send any document there »', async () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(26, 1),
      Buffer.from('[Content_Types].xml'),
      Buffer.alloc(64, 2),
    ]);
    const saved = await inTenant(() =>
      attachments.attach(homeworkId, { buffer: docx, filename: 'Fiche de révision.docx' }, ACTOR),
    );
    expect(saved.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(saved.displayName).toBe('Fiche de révision.docx');
  });

  it('⚠ mais pas un .zip renommé', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('programme.exe'), Buffer.alloc(64)]);
    await expect(
      inTenant(() => attachments.attach(homeworkId, { buffer: zip, filename: 'fiche.docx' }, ACTOR)),
    ).rejects.toThrow(UploadRejected);
  });
});
