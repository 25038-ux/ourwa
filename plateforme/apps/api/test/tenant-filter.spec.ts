import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `user_school_roles` is the one table where the filter is by hand.
 *
 * It is a PLATFORM table carrying `school_id` as data, with no RLS, and that is
 * deliberate (ADR-0006): `schoolsForUser()` has to see across schools, because a
 * parent may have children at two branches and a platform administrator belongs
 * to none. A policy would make that lookup impossible.
 *
 * The cost is that every OTHER query against it must remember `school_id = …`,
 * and "remember" is not a mechanism. This test is the mechanism: it reads the
 * source and fails if a query touches the table without scoping it.
 *
 * The deliberate exception is named here, once, so adding a second one is a
 * decision somebody has to write down rather than an oversight.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Queries that read the table across schools ON PURPOSE. */
const CROSS_SCHOOL_BY_DESIGN = [
  // A parent with children at two branches, and the platform admin's own list.
  'SELECT DISTINCT school_id FROM user_school_roles WHERE user_id = $1',
];

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (entry.endsWith('.ts')) yield path;
  }
}

/**
 * The statement surrounding each mention of the table.
 *
 * Crude on purpose: a window of lines, not a SQL parser. A parser here would be
 * a second thing that can be wrong, and the question — "does `school_id` appear
 * anywhere near this" — does not need one.
 */
function statementsTouching(source: string, table: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.includes(table)) continue;
    // Widen until the surrounding template literal is plausibly covered.
    const from = Math.max(0, i - 6);
    const to = Math.min(lines.length, i + 8);
    found.push(lines.slice(from, to).join('\n'));
  }
  return found;
}

describe('user_school_roles is always scoped by hand', () => {
  it('has no query that forgets school_id', () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const statement of statementsTouching(source, 'user_school_roles')) {
        const collapsed = statement.replace(/\s+/g, ' ');
        const deliberate = CROSS_SCHOOL_BY_DESIGN.some((allowed) =>
          collapsed.includes(allowed.replace(/\s+/g, ' ')),
        );
        if (deliberate) continue;
        if (!collapsed.includes('school_id')) {
          offenders.push(`${relative(SRC, file)}: ${collapsed.slice(0, 120)}`);
        }
      }
    }

    expect(
      offenders,
      'a query on user_school_roles with no school_id — it would cross tenants',
    ).toEqual([]);
  });

  it('detects the mistake it exists to catch', () => {
    // The control. A guard nobody has watched fail proves nothing.
    const broken = [
      'const { rows } = await tx.query(',
      "  `SELECT role_id FROM user_school_roles WHERE user_id = $1`,",
      '  [userId],',
      ');',
    ].join('\n');
    const statements = statementsTouching(broken, 'user_school_roles');
    expect(statements).toHaveLength(1);
    expect(statements[0]!.includes('school_id')).toBe(false);
  });

  it('still recognises the one deliberate cross-school lookup', () => {
    // If this ever fails, `schoolsForUser` was rewritten and the exemption above
    // now points at nothing — which would silently start allowing new unscoped
    // queries through.
    const permissions = readFileSync(join(SRC, 'auth', 'permissions.service.ts'), 'utf8');
    expect(permissions.replace(/\s+/g, ' ')).toContain(
      CROSS_SCHOOL_BY_DESIGN[0]!.replace(/\s+/g, ' '),
    );
  });
});
