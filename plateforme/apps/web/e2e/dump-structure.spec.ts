import { test } from './session';
import fs from 'node:fs';
import path from 'node:path';

/**
 * EMPREINTE STRUCTURELLE DE CHAQUE PAGE — l'outil de comparaison, pas un test.
 *
 * ⚠ IL EXISTE PARCE QUE COMPARER DES TITRES NE VOIT PAS UNE MISE EN PAGE.
 * Les passes précédentes échantillonnaient `h3`, `th`, `label` — ce qui ne dit
 * rien d'un `div.form-row` groupant trois champs là où l'original les empile,
 * ni d'un `section.table-container` de plus autour d'un formulaire. C'est
 * pourtant cela qu'on voit en premier.
 *
 * Il écrit la suite RÉELLE des éléments, dans l'ordre du document, avec leurs
 * classes porteuses de mise en page. Le pendant PHP est `dump_php.py`.
 *
 * Ce n'est pas exécuté par la suite ordinaire : il ne vérifie rien, il décrit —
 * et ses trente-quatre pages compilées à la volée dépassent cinq minutes dès
 * que le poste est chargé (un Gradle à côté), ce qui faisait « échouer » la
 * suite sans qu'aucune page soit fausse. `STRUCTURE=1 … --grep @structure`
 * pour le lancer.
 */

const DEST = path.join(process.cwd(), 'e2e', '.structure');

const ROUTES = [
  '/', '/students/new', '/re-enrol', '/re-enrol/bulk', '/annees',
  '/scolarite', '/scolarite/absence', '/scolarite/groupes', '/scolarite/niveaux',
  '/scolarite/exclusions', '/scolarite/emploi', '/notes',
  '/finance', '/finance/revenue', '/finance/rapport', '/finance/staff',
  '/finance/dettes', '/finance/depenses', '/finance/impayes',
  '/finance/administrateurs', '/evening', '/comptes', '/comptes/parents',
  '/comptes/professeurs', '/comptes/staff', '/comptes/creer', '/journal',
  '/messages', '/statistiques', '/search', '/profile', '/requests',
  '/homework', '/derogations',
];

// ⚠ SANS CET ÉTAT, CHAQUE PAGE REDIRIGE VERS /login et le vidage est vide —
// trente-quatre fichiers de zéro octet qui ressemblent à un outil cassé.
test.use({ storageState: 'e2e/.auth/nour-admin.json' });

test('@structure dump', async ({ page }) => {
  test.skip(!process.env.STRUCTURE, 'Outil de comparaison, pas un test : STRUCTURE=1 pour le lancer.');
  test.setTimeout(300_000);
  fs.mkdirSync(DEST, { recursive: true });

  for (const route of ROUTES) {
    await page.goto(`http://nour.localhost:3000${route}`, { waitUntil: 'domcontentloaded' });
    const lignes = await page.evaluate(() => {
      const UTILES =
        /form-(card|row|group|actions)|table-(container|header)|hub-|modal|alert|btn|badge|kpi|grid|stack|overflow-x|section|panel|radio|check/;
      const out: string[] = [];
      const walk = (n: Element, prof: number) => {
        for (const el of Array.from(n.children)) {
          const tag = el.tagName.toLowerCase();
          const cls = typeof el.className === 'string' ? el.className : '';
          const garde =
            ['form', 'h1', 'h2', 'h3', 'h4', 'label', 'input', 'select',
             'textarea', 'button', 'table', 'th', 'hr', 'option'].includes(tag) ||
            UTILES.test(cls);
          let px = prof;
          if (garde) {
            let m = tag;
            const u = cls.split(/\s+/).filter((c) => UTILES.test(c)).sort();
            if (u.length) m += '.' + u.join('.');
            if (['input', 'select', 'textarea'].includes(tag)) {
              const e = el as HTMLInputElement;
              m += `[${e.type || tag}${e.name ? ' name=' + e.name : ''}${e.required ? ' required' : ''}]`;
            }
            const t = el.children.length === 0 ? (el.textContent ?? '').trim() : '';
            out.push('  '.repeat(prof) + m + (t && t.length < 90 ? `  « ${t} »` : ''));
            px = prof + 1;
          }
          walk(el, px);
        }
      };
      const main = document.querySelector('main');
      if (main) walk(main, 0);
      return out;
    });

    // Une seule <option> par select : les listes noient la structure.
    const filtre: string[] = [];
    let vuOption = false;
    for (const l of lignes) {
      const estOption = l.trim().startsWith('option');
      if (estOption && vuOption) continue;
      vuOption = estOption;
      filtre.push(l);
    }

    const nom = (route === '/' ? 'racine' : route.slice(1).replace(/\//g, '_')) + '.txt';
    fs.writeFileSync(path.join(DEST, nom), filtre.join('\n'), 'utf8');
    console.log(`${route.padEnd(28)} ${filtre.length} éléments`);
  }
});
