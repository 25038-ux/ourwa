import { test, expect } from './session';

/**
 * CHAQUE PAGE SUR UN TÉLÉPHONE — 375 × 812, la taille d'un téléphone courant.
 *
 * Deux exigences par page : aucun défilement horizontal du document (rien ne
 * dépasse la largeur de l'écran), et la barre latérale ne recouvre pas le
 * contenu (elle est repliée, ouverte par le bouton). Les tableaux larges ont le
 * droit de défiler DANS leur conteneur (`.table-container`, `.overflow-x`) ;
 * c'est le document qui ne doit pas déborder.
 *
 * Le rapport nomme les éléments qui dépassent, pour corriger la feuille
 * `responsive.css` et non deviner.
 */

const PAGES = [
  '/', '/annees', '/comptes', '/comptes/creer', '/comptes/parents',
  '/comptes/professeurs', '/comptes/staff', '/derogations', '/evening', '/evening/professeurs',
  '/finance', '/finance/administrateurs', '/finance/depenses', '/finance/dettes',
  '/finance/impayes', '/finance/rapport', '/finance/revenue', '/finance/staff', '/homework',
  '/journal', '/messages', '/notes', '/prof', '/prof/classes',
  '/prof/emploi', '/prof/exercice', '/prof/notes', '/prof/remarques', '/profile', '/re-enrol', '/re-enrol/bulk',
  '/requests', '/scolarite', '/scolarite/absence', '/scolarite/emploi',
  '/scolarite/exclusions', '/scolarite/groupes', '/scolarite/niveaux', '/scolarite/notes',
  '/search', '/statistiques', '/students/new', '/login',
];

test.use({ storageState: 'e2e/.auth/nour-admin.json', viewport: { width: 375, height: 812 } });

interface Debordement { tag: string; classe: string; droite: number; largeur: number; texte: string }

async function mesurer(page: import('@playwright/test').Page): Promise<{ scrollWidth: number; clientWidth: number; debordements: Debordement[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const limite = doc.clientWidth + 1;
    const out: { tag: string; classe: string; droite: number; largeur: number; texte: string }[] = [];
    // Les éléments dont le bord droit dépasse l'écran, hors ceux qui vivent dans
    // un conteneur à défilement horizontal (tableaux larges, légitimes).
    const dansDefilant = (el: Element): boolean => {
      let p: Element | null = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.clientWidth <= doc.clientWidth) return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > limite && !dansDefilant(el)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          classe: String(el.className || '').slice(0, 60),
          droite: Math.round(r.right),
          largeur: Math.round(r.width),
          texte: (el.textContent || '').trim().slice(0, 40),
        });
      }
      if (out.length >= 12) break;
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, debordements: out };
  });
}

for (const chemin of PAGES) {
  test(`${chemin} tient dans 375 px`, async ({ page }) => {
    const reponse = await page.goto(`http://nour.localhost:3000${chemin}`, { waitUntil: 'networkidle' });
    expect(reponse?.status(), chemin).toBeLessThan(500);
    const m = await mesurer(page);
    const detail = m.debordements.map((d) => `${d.tag}.${d.classe} droite=${d.droite} largeur=${d.largeur} « ${d.texte} »`).join('\n');
    expect(m.scrollWidth, `${chemin} : le document déborde (${m.scrollWidth} > ${m.clientWidth})\n${detail}`).toBeLessThanOrEqual(m.clientWidth + 1);
    expect(m.debordements, `${chemin} : éléments hors écran\n${detail}`).toEqual([]);

    // La barre latérale : repliée sur téléphone, le contenu visible.
    if (chemin !== '/login') {
      const sidebar = page.locator('aside.sidebar');
      if (await sidebar.count()) {
        const box = await sidebar.boundingBox();
        const main = await page.locator('main.main-content').boundingBox();
        expect(main, `${chemin} : contenu principal`).not.toBeNull();
        // Soit hors écran (drawer fermé), soit au-dessus du contenu sans le pousser hors de l'écran.
        if (box && box.x >= 0 && box.width >= 375 * 0.5) {
          expect(main!.x, `${chemin} : la barre latérale masque le contenu`).toBeGreaterThanOrEqual(box.x + box.width - 1);
        }
      }
    }
  });
}

/**
 * ⚠ LE MENU S'OUVRE SUR TÉLÉPHONE (propriétaire, 23/09/2026 : « the sidebar
 * disappears »). Le test ci-dessus vérifiait que la barre était repliée — pas
 * qu'il existait un moyen de l'ouvrir : le bouton n'avait jamais été porté.
 */
test('le bouton du menu ouvre et referme la barre latérale à 375 px', async ({ page }) => {
  await page.goto('http://nour.localhost:3000/finance', { waitUntil: 'networkidle' });
  const bouton = page.locator('#sidebar-toggle');
  const barre = page.locator('aside#sidebar');
  await expect(bouton).toBeVisible();
  await expect(bouton).toHaveAttribute('aria-expanded', 'false');
  expect((await barre.boundingBox())!.x).toBeLessThan(0);

  await bouton.click();
  await expect(barre).toHaveClass(/open/);
  await expect(bouton).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => Math.round((await barre.boundingBox())!.x)).toBe(0);
  await expect(barre.getByRole('link', { name: 'Tableau de bord' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(barre).not.toHaveClass(/open/);
  await expect(bouton).toBeFocused();

  // Toucher un lien du tiroir ouvre la page ET referme le tiroir.
  await bouton.click();
  await barre.getByRole('link', { name: 'Recherche' }).click();
  await page.waitForURL('**/search**');
  await expect(page.locator('#sidebar-toggle')).toBeVisible();
  await expect(page.locator('aside#sidebar')).not.toHaveClass(/open/);
});
