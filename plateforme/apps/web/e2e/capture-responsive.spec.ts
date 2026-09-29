import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * RELEVÉ DE MISE EN PAGE — CHAQUE PAGE À CINQ LARGEURS (outil, pas un test).
 *
 *   CAPTURE=1 pnpm exec playwright test e2e/capture-responsive.spec.ts --workers=1
 *
 * Pour chaque page et chaque largeur — téléphone 375, iPad portrait 820, 1024
 * (le seuil du tiroir), iPad paysage 1180, bureau 1440 — une capture
 * (e2e/.captures/<largeur>/<page>.png, 3 000 px de haut au plus) et des
 * mesures (e2e/.captures/mesures.json) : débordement du document, éléments
 * hors écran, cibles tactiles trop petites, texte trop petit, tableaux sans
 * défilement. Sans CAPTURE=1, tout est sauté : la suite ordinaire n'en paie rien.
 */

const LARGEURS = [
  { nom: '375', w: 375, h: 812 },
  { nom: '820', w: 820, h: 1180 },
  { nom: '1024', w: 1024, h: 768 },
  { nom: '1180', w: 1180, h: 820 },
  { nom: '1440', w: 1440, h: 900 },
];

const PAGES = [
  '/', '/annees', '/comptes', '/comptes/creer', '/comptes/parents',
  '/comptes/professeurs', '/comptes/staff', '/derogations', '/evening', '/evening/professeurs',
  '/finance', '/finance/administrateurs', '/finance/depenses', '/finance/dettes',
  '/finance/impayes', '/finance/rapport', '/finance/revenue', '/finance/staff', '/homework',
  '/journal', '/messages', '/notes', '/prof', '/prof/classes',
  '/prof/emploi', '/prof/exercice', '/prof/notes', '/prof/remarques', '/profile', '/re-enrol', '/re-enrol/bulk',
  '/requests', '/scolarite', '/scolarite/absence', '/scolarite/emploi',
  '/scolarite/exclusions', '/scolarite/groupes', '/scolarite/niveaux', '/scolarite/notes',
  '/search', '/statistiques', '/students/new',
];

const SORTIE = path.join(process.cwd(), 'e2e', '.captures');
const MESURES = path.join(SORTIE, 'mesures.json');

test.skip(!process.env.CAPTURE, 'outil : CAPTURE=1 pour l’exécuter');
// Pas de mode « serial » : une page lente ne doit pas faire rejouer toutes les suivantes.
// CAPTURE_REPRISE=1 saute les pages déjà relevées à toutes les largeurs.
const REPRISE = !!process.env.CAPTURE_REPRISE;
const dejaReleve = (etiquette: string) =>
  REPRISE && LARGEURS.every((l) => lire().some((m) => m.page === etiquette && m.largeur === l.nom) && fs.existsSync(path.join(SORTIE, l.nom, `${nomFichier(etiquette)}.png`)));

interface Mesure {
  page: string;
  largeur: string;
  statut: number | null;
  debordementDocument: number;
  horsEcran: string[];
  ciblesPetites: { total: number; exemples: string[] };
  textePetit: { total: number; exemples: string[] };
  tableauxSansDefilement: string[];
  hauteurEntete: number;
  boutonMenuVisible: boolean;
  barreLateraleVisible: boolean;
  chevauchementBouton: string[];
}

function lire(): Mesure[] {
  try {
    return JSON.parse(fs.readFileSync(MESURES, 'utf8')) as Mesure[];
  } catch {
    return [];
  }
}

function ecrire(m: Mesure) {
  const toutes = lire().filter((x) => !(x.page === m.page && x.largeur === m.largeur));
  toutes.push(m);
  fs.mkdirSync(SORTIE, { recursive: true });
  fs.writeFileSync(MESURES, JSON.stringify(toutes, null, 1));
}

const nomFichier = (p: string) => (p === '/' ? 'accueil' : p.replace(/^\//, '').replace(/[^\w-]+/g, '_'));

async function mesurer(page: Page, largeur: number) {
  return page.evaluate((largeurEcran) => {
    const doc = document.documentElement;
    const limite = doc.clientWidth + 1;
    const decrire = (el: Element) => {
      const c = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${c ? '.' + c.trim().split(/\s+/).slice(0, 2).join('.') : ''}${t ? ` « ${t} »` : ''}`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const dansDefilant = (el: Element): boolean => {
      let p: Element | null = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p.clientWidth <= doc.clientWidth) return true;
        p = p.parentElement;
      }
      return false;
    };
    const tiroir = document.getElementById('sidebar');
    const dansTiroirFerme = (el: Element) => !!tiroir && tiroir.contains(el) && tiroir.getBoundingClientRect().right <= 0;

    const horsEcran: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || !visible(el) || dansTiroirFerme(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > limite && !dansDefilant(el)) horsEcran.push(`${decrire(el)} (droite ${Math.round(r.right)})`);
      if (horsEcran.length >= 8) break;
    }

    // Cibles tactiles : sous 1024 px on touche au doigt — 40 px est un minimum raisonnable.
    const cibles = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary'))
      .filter((el) => visible(el) && !dansTiroirFerme(el));
    const petites = cibles.filter((el) => {
      if (largeurEcran > 1024) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (el.tagName === 'A' && s.display === 'inline' && el.closest('p, td, li, small')) return false; // lien dans du texte
      if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') return r.height < 20 || r.width < 20;
      return r.height < 36;
    });

    // Texte sous 12 px.
    const petitsTextes: string[] = [];
    let totalPetit = 0;
    const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vus = new Set<Element>();
    while (marcheur.nextNode()) {
      const n = marcheur.currentNode as Text;
      const el = n.parentElement;
      if (!el || vus.has(el) || !(n.textContent || '').trim()) continue;
      vus.add(el);
      if (!visible(el) || dansTiroirFerme(el)) continue;
      const taille = parseFloat(getComputedStyle(el).fontSize);
      if (taille < 12) {
        totalPetit += 1;
        if (petitsTextes.length < 6) petitsTextes.push(`${decrire(el)} ${taille}px`);
      }
    }

    const tableaux = Array.from(document.querySelectorAll('table'))
      .filter((t) => visible(t) && t.getBoundingClientRect().width > doc.clientWidth + 1 && !dansDefilant(t))
      .map(decrire);

    const entete = document.querySelector('.page-header');
    const bouton = document.getElementById('sidebar-toggle');
    const boutonVisible = !!bouton && visible(bouton);
    const chevauchement: string[] = [];
    if (boutonVisible && bouton) {
      const rb = bouton.getBoundingClientRect();
      for (const el of Array.from(document.querySelectorAll('.page-header h1, .page-header h2, .page-title, .page-header *'))) {
        if (el === bouton || bouton.contains(el) || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        const croise = r.left < rb.right && r.right > rb.left && r.top < rb.bottom && r.bottom > rb.top;
        if (croise && (el.textContent || '').trim()) chevauchement.push(decrire(el));
        if (chevauchement.length >= 3) break;
      }
    }

    return {
      debordementDocument: doc.scrollWidth - doc.clientWidth,
      horsEcran,
      ciblesPetites: { total: petites.length, exemples: petites.slice(0, 6).map((el) => `${decrire(el)} ${Math.round(el.getBoundingClientRect().height)}px`) },
      textePetit: { total: totalPetit, exemples: petitsTextes },
      tableauxSansDefilement: tableaux,
      hauteurEntete: entete ? Math.round(entete.getBoundingClientRect().height) : 0,
      boutonMenuVisible: boutonVisible,
      barreLateraleVisible: !!tiroir && visible(tiroir) && tiroir.getBoundingClientRect().right > 0,
      chevauchementBouton: chevauchement,
    };
  }, largeur);
}

async function capturer(page: Page, url: string, etiquette: string) {
  if (dejaReleve(etiquette)) return;
  // La première compilation d'une page par le serveur de développement peut
  // dépasser 45 s : on la réchauffe une fois, patiemment.
  await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
  for (const l of LARGEURS) {
    await page.setViewportSize({ width: l.w, height: l.h });
    const reponse = await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
    await page.waitForTimeout(250);
    const m = await mesurer(page, l.w);
    ecrire({ page: etiquette, largeur: l.nom, statut: reponse?.status() ?? null, ...m });
    const dossier = path.join(SORTIE, l.nom);
    fs.mkdirSync(dossier, { recursive: true });
    const hauteur = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({
      path: path.join(dossier, `${nomFichier(etiquette)}.png`),
      fullPage: true,
      clip: { x: 0, y: 0, width: l.w, height: Math.min(hauteur, 3000) },
    });
  }
}

test.describe('personnel (Nour, direction)', () => {
  test.use({ storageState: 'e2e/.auth/nour-admin.json' });
  for (const p of PAGES) {
    test(`relevé ${p}`, async ({ page }) => {
      test.setTimeout(600_000);
      await capturer(page, `http://nour.localhost:3000${p}`, p);
      expect(true).toBe(true);
    });
  }
  test('relevé du dossier d’une famille et d’un bulletin', async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto('http://nour.localhost:3000/finance', { waitUntil: 'networkidle' });
    const liens = await page.locator('a[href*="/finance/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const famille = liens.find((h) => /\/finance\/[0-9a-f-]{36}$/.test(h));
    if (famille) await capturer(page, `http://nour.localhost:3000${famille}`, '/finance/[famille]');
    await page.goto('http://nour.localhost:3000/scolarite/notes', { waitUntil: 'networkidle' });
    await page.locator('select#groupe_id').selectOption({ index: 1 }).catch(() => undefined);
    await page.waitForLoadState('networkidle');
    const autres = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const bulletin = autres.find((h) => /\/notes\/bulletin\/[0-9a-f-]{36}/.test(h));
    if (bulletin) await capturer(page, `http://nour.localhost:3000${bulletin}`, '/notes/bulletin/[eleve]');
  });
});

test.describe('pages publiques', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const [url, etiquette] of [
    ['http://nour.localhost:3000/login', '/login'],
    ['http://nour.localhost:3000/legal/confidentialite', '/legal/confidentialite'],
    ['http://admin.localhost:3000/login', '/platform-login'],
  ] as const) {
    test(`relevé ${etiquette}`, async ({ page }) => {
      test.setTimeout(600_000);
      await capturer(page, url, etiquette);
    });
  }
});

test.describe('console de la plateforme', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('relevé /platform', async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto('http://admin.localhost:3000/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Identifiant').fill('admin@platform.test');
    await page.locator('input[type=password]').fill('dev12345');
    await page.locator('button[type=submit]').click();
    await page.waitForLoadState('networkidle');
    await capturer(page, 'http://admin.localhost:3000/platform', '/platform');
  });
});
