import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLES } from '@elourwa/db/seed-roles';

/**
 * ⚠ A `@RequirePermission` NAMING A PERMISSION THAT DOES NOT EXIST IS A CLOSED
 * DOOR WITH NO SIGN ON IT.
 *
 * The guard checks the caller's granted permissions against the strings in the
 * decorator. A string nobody was ever granted matches nobody — so the endpoint
 * is unreachable by every role including the super administrateur, and it fails
 * with 403 rather than with anything that says why. Nothing in the type system
 * catches it: a permission is a string.
 *
 * This was written after `coursdusoir.gerer` was invented for two new evening
 * endpoints. The catalogue has 24 permissions and none of them is that; the two
 * endpoints would have shipped permanently closed, and the symptom on the screen
 * would have been "Assigner un professeur does nothing".
 *
 * The catalogue is read from `seed-roles.ts` — the module that exists precisely
 * so "the seed and the test cannot disagree" — rather than from a list written
 * here, which would be a second thing to keep in step with the first. It is NOT
 * read from the database: the test harness runs migrations without the seed, so
 * `role_permissions` is empty there and the check would pass by knowing nothing.
 */

const granted = new Set<string>(ROLES.flatMap((r) => r.perms as readonly string[]));

// ⚠ `new URL(...).pathname` percent-encodes the spaces in "El Ourwa app".
// `fileURLToPath` is the one that gives a path the filesystem accepts.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('every permission named in a guard', () => {
  it('is one somebody has actually been granted', () => {
    // The catalogue must not be empty, or this test passes by knowing nothing.
    expect(granted.size).toBeGreaterThanOrEqual(24);

    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/@RequirePermission\(([^)]*)\)/g)) {
        for (const name of match[1]!.matchAll(/'([^']+)'/g)) {
          if (!granted.has(name[1]!)) {
            offenders.push(`${file.slice(SRC.length + 1)}: ${name[1]}`);
          }
        }
      }
    }

    expect(
      offenders,
      'a permission no role holds closes the endpoint to everyone, silently',
    ).toEqual([]);
  });

  it('detects the mistake it exists to catch', () => {
    // The control: a guard nobody has watched fail proves nothing.
    const invented = 'coursdusoir.gerer';
    expect(granted.has(invented)).toBe(false);
  });
});
