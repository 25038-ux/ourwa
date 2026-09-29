import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { readStored, storeUpload, uploadRoot, type StoredFile } from './storage.js';

/**
 * Files attached to homework.
 *
 * ⚠ THE ACCESS CHECK IS THE POINT.
 *
 * El Ourwa serves these straight from Apache out of `/uploads/exercices/`, so
 * the random filename IS the access control: anyone holding the URL can read the
 * file, signed in or not. Its own comment explains that storing outside the
 * document root was impossible on XAMPP — a constraint, not a choice.
 *
 * We hand files out through a route instead, so a leaked link is not a leaked
 * document. Who may read one:
 *
 *   - staff who can send exercises, or who administer classes
 *   - the teacher whose teaching it belongs to
 *   - a guardian with a child enrolled in that class
 *
 * and nobody else, including a signed-in parent from another family.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async attach(
    homeworkId: string,
    file: { buffer: Buffer; filename: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    // The homework must exist IN THIS SCHOOL before anything touches the disk.
    // Writing first would leave an orphan file for every mistyped id.
    const exists = await this.db.query(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM homework WHERE id = $1', [homeworkId]);
      return rows.length > 0;
    });
    if (!exists) throw new NotFoundException('Exercice introuvable.');

    const stored: StoredFile = await storeUpload(file.buffer, file.filename, schoolId);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO attachments
           (school_id, homework_id, display_name, stored_name, mime, bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          schoolId, homeworkId, stored.displayName, stored.storedName,
          stored.mime, stored.bytes, actorId,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'attachment_added',
          entity: 'attachment',
          entityId: rows[0]!.id,
          after: { homeworkId, name: stored.displayName, bytes: stored.bytes },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        displayName: stored.displayName,
        mime: stored.mime,
        bytes: stored.bytes,
      };
    });
  }

  /**
   * Does every row still have its file, and every file still have a row?
   *
   * ⚠ THE ONLY WAY TO KNOW A RESTORE WAS COMPLETE.
   *
   * Attachments live on disk while their metadata lives in Postgres, so a
   * database-only restore produces a school whose every attachment is a broken
   * link — and nothing anywhere would say so until a parent tapped one. This
   * answers the question directly.
   *
   * Orphaned FILES are reported too, and are the less alarming direction: a row
   * deleted with its homework leaves the bytes behind, which wastes space but
   * loses nothing.
   */
  async integrity() {
    const { schoolId } = currentTenant();

    const rows = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; stored_name: string; display_name: string }>(
        'SELECT id, stored_name, display_name FROM attachments',
      );
      return rows;
    });

    const missing: { id: string; displayName: string }[] = [];
    for (const row of rows) {
      try {
        await readStored(schoolId, row.stored_name);
      } catch {
        missing.push({ id: row.id, displayName: row.display_name });
      }
    }

    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const onDisk = await readdir(join(uploadRoot(), schoolId)).catch(() => [] as string[]);
    const known = new Set(rows.map((r) => r.stored_name));
    const orphanFiles = onDisk.filter((name) => !known.has(name));

    return {
      rows: rows.length,
      files: onDisk.length,
      missingFiles: missing,
      orphanFiles,
      // The single answer somebody restoring a backup actually wants.
      complete: missing.length === 0,
    };
  }

  async forHomework(homeworkId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, display_name, mime, bytes, created_at
           FROM attachments WHERE homework_id = $1 ORDER BY created_at`,
        [homeworkId],
      );
      return rows;
    });
  }

  /**
   * Fetch a file, having established that this person may read it.
   *
   * The permission check and the read are one operation on purpose: separating
   * them invites a caller that does the second without the first.
   */
  async download(
    attachmentId: string,
    userId: string,
    permissions: string[],
  ): Promise<{ buffer: Buffer; mime: string; displayName: string }> {
    const { schoolId } = currentTenant();

    const row = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        stored_name: string;
        mime: string;
        display_name: string;
        teaching_id: string;
      }>(
        `SELECT a.stored_name, a.mime, a.display_name, h.teaching_id
           FROM attachments a
           JOIN homework h ON h.id = a.homework_id
          WHERE a.id = $1`,
        [attachmentId],
      );
      return rows[0];
    });
    if (!row) throw new NotFoundException('Pièce jointe introuvable.');

    const staff =
      permissions.includes('exercices.envoyer') || permissions.includes('scolarite.groupes');

    if (!staff) {
      const allowed = await this.db.query(async (tx) => {
        const { rows } = await tx.query(
          `SELECT 1
             FROM teachings t
             LEFT JOIN teachers te ON te.id = t.teacher_id
             LEFT JOIN enrollments e ON e.group_id = t.group_id
                                    AND e.academic_year_id = t.academic_year_id
                                    AND e.status <> 'cancelled'
             LEFT JOIN students s ON s.id = e.student_id
            WHERE t.id = $1
              AND (te.user_id = $2 OR s.guardian_id = $2)
            LIMIT 1`,
          [row.teaching_id, userId],
        );
        return rows.length > 0;
      });
      if (!allowed) {
        throw new ForbiddenException('Ce document n’appartient pas à votre classe.');
      }
    }

    const buffer = await readStored(schoolId, row.stored_name);
    return { buffer, mime: row.mime, displayName: row.display_name };
  }
}
