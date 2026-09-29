import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A backtick inside a SQL template literal ends the literal.
 *
 * It has now broken the build three times, always the same way: a comment
 * written in the habit of prose — `revoked_at IS NULL` — silently terminates the
 * string, and the error surfaces dozens of lines later as "Expected )" pointing
 * at innocent SQL. Typecheck catches it, but only after a dev server has already
 * crash-looped.
 *
 * This finds it at the character, with the line number, in one second.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (entry.endsWith('.ts')) yield path;
  }
}

/**
 * Lines that sit inside a template literal AND contain a lone backtick.
 *
 * Deliberately simple: it walks the file counting backticks, so a line with a
 * backtick while an odd number have been seen is inside a literal. That is
 * exactly the condition that breaks, and a cleverer parser would be a second
 * thing to get wrong.
 */
function strayBackticks(source: string): number[] {
  const lines = source.split('\n');
  const bad: number[] = [];
  let open = false;

  /*
   * ⚠ SEULEMENT LES COMMENTAIRES `--`, ET J'AI ESSAYÉ D'ÉLARGIR — À TORT.
   *
   * La même faute m'est arrivée une fois de plus dans un bloc `/* … *\/` à
   * l'intérieur d'un literal, et j'ai voulu couvrir cette forme aussi. Le
   * résultat a signalé cinq commentaires JSDoc parfaitement normaux : le
   * comptage d'accents graves croit être « dans un literal » au milieu d'une
   * paire ouverte sur une ligne et fermée sur la suivante, ce qui est le cas
   * courant en documentation.
   *
   * Un garde qui crie sur du code correct se fait désactiver. Celui-ci reste
   * sur `--`, où il n'a pas d'ambiguïté ; la forme en bloc est attrapée par le
   * typecheck en quelques secondes, ce qui suffit.
   */
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const comment = line.indexOf('--');
    if (open && comment !== -1 && line.slice(comment).includes('`')) {
      bad.push(i + 1);
    }
    for (const char of line) {
      if (char === '`') open = !open;
    }
  }
  return bad;
}

describe('SQL template literals', () => {
  it('contain no backticks inside their comments', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const lines = strayBackticks(readFileSync(file, 'utf8'));
      for (const line of lines) {
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders, 'a backtick in a SQL comment ends the template literal').toEqual([]);
  });

  it('detects the mistake it exists to catch', () => {
    // The control: a guard nobody has watched fail proves nothing.
    const broken = [
      'const q = await tx.query(',
      '  `SELECT 1',
      '     -- `revoked_at IS NULL` is the condition',
      '   FROM t`,',
      ');',
    ].join('\n');
    expect(strayBackticks(broken)).toEqual([3]);
  });

  it('does not flag a backtick in ordinary code or prose', () => {
    const fine = [
      '/** A doc comment mentioning `revoked_at` is fine. */',
      'const name = `${a}-${b}`;',
      'const sql = `SELECT 1 -- no backticks here',
      '  FROM t`;',
    ].join('\n');
    expect(strayBackticks(fine)).toEqual([]);
  });
});

/**
 * ⚠ A DUPLICATE ROUTE MAKES THE WHOLE APP FAIL TO BOOT, AND VITEST REPORTS
 * THAT AS "SKIPPED".
 *
 * Adding `@Get(':id/months')` to a controller that already had one produced
 * "Method 'GET' already declared for route '/academic-years/:/months'". Nest
 * refused to start, so every spec that builds the module reported 6 skipped and
 * 3 skipped — a green-looking run with nine tests silently not executed, two of
 * them the cross-school isolation suite.
 *
 * A skip is not a pass. This asserts the module actually compiles.
 */
describe('the application boots', () => {
  it('⚠ has no duplicate routes — a skipped suite is not a passing one', async () => {
    // Compiling the module is what the duplicate route breaks, and it is what
    // every other spec does in `beforeAll` — where a throw turns into a skip
    // rather than a failure. Here it is the assertion itself.
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module.js');
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).resolves.toBeTruthy();
  });
});
