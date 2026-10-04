import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_OCTETS_FICHIER, verifierFichier, type FamilleFichier } from '@elourwa/shared/fichiers';

/**
 * Validating and storing an uploaded file.
 *
 * Ported from El Ourwa v16 `includes/upload.php`, whose defence in depth is
 * worth keeping literally:
 *
 *   1. a size ceiling                    (a cheap denial of service otherwise)
 *   2. the REAL type, read from the bytes — never the browser's claim
 *   3. magic-byte signatures             (a .pdf that begins with `<?php` is not)
 *   4. an extension that agrees with the content
 *   5. a random stored name              (no overwrite, no traversal, no guessing)
 *   6. a directory that cannot execute anything
 *
 * Steps 2 to 4 are three checks on the same question because each catches what
 * the others miss: the declared type is attacker-controlled, `finfo` can be
 * fooled by a crafted prefix, and an extension is only a string.
 */

/**
 * The rule itself lives in `@elourwa/shared/fichiers` — the web reads the same
 * one to warn BEFORE sending. Since 04/10/2026 it admits office documents
 * (Word, Excel, PowerPoint, OpenDocument, RTF) and 10 MB a file.
 */
export const MAX_BYTES = MAX_OCTETS_FICHIER;

export class UploadRejected extends Error {}

/** Strip anything that is not a plain name. For DISPLAY only, never for a path. */
export function safeDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || 'fichier';
}

export interface StoredFile {
  storedName: string;
  displayName: string;
  mime: string;
  bytes: number;
}

/**
 * Where uploads live.
 *
 * Outside any directory the web server serves, unlike El Ourwa's, which had no
 * choice on XAMPP and defends `/uploads/` with an `.htaccess`. Ours is reachable
 * only through a route that checks who is asking.
 */
export function uploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), '.uploads'));
}

export async function storeUpload(
  buffer: Buffer,
  originalName: string,
  schoolId: string,
  familles: readonly FamilleFichier[] = ['image', 'pdf', 'bureau'],
): Promise<StoredFile> {
  const verdict = verifierFichier(buffer, originalName, familles);
  if ('refus' in verdict) throw new UploadRejected(verdict.refus);
  const mime = verdict.mime;
  const extension = (originalName.split('.').pop() ?? '').toLowerCase();

  // Per school, so one branch's files are not even in the same directory as
  // another's — the tenant boundary held in the filesystem as well as in RLS.
  const directory = join(uploadRoot(), schoolId);
  await mkdir(directory, { recursive: true });

  const storedName = `${randomBytes(16).toString('hex')}.${extension}`;
  await writeFile(join(directory, storedName), buffer, { mode: 0o640 });

  return {
    storedName,
    displayName: safeDisplayName(originalName),
    mime,
    bytes: buffer.length,
  };
}

/**
 * Read a stored file back.
 *
 * `storedName` is validated against its own shape rather than trusted, because
 * it reaches here from a database row that an earlier bug could have poisoned.
 * A path is never built from anything a request supplied.
 */
export async function readStored(schoolId: string, storedName: string): Promise<Buffer> {
  if (!/^[0-9a-f]{32}\.[a-z0-9]{2,5}$/.test(storedName)) {
    throw new UploadRejected('Nom de fichier invalide.');
  }
  return readFile(join(uploadRoot(), schoolId, storedName));
}

export async function deleteStored(schoolId: string, storedName: string): Promise<void> {
  if (!/^[0-9a-f]{32}\.[a-z0-9]{2,5}$/.test(storedName)) return;
  await unlink(join(uploadRoot(), schoolId, storedName)).catch(() => undefined);
}
