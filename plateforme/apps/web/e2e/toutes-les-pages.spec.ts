import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * CHAQUE PAGE DU PERSONNEL, OUVERTE UNE FOIS, EN TANT QUE DIRECTEUR.
 *
 * ⚠ LES AUTRES SPECS OUVRENT LES PAGES QU'ELLES CONNAISSENT. Celle-ci ouvre
 * TOUTES celles qui existent — la liste est lue du système de fichiers, pas
 * recopiée — et exige de chacune trois choses : qu'elle réponde 200, qu'elle
 * ne mette aucune erreur dans la console, et qu'elle n'affiche ni « 500 » ni
 * « Application error ». Une page ajoutée demain est vérifiée sans qu'on y pense.
 *
 * Les routes à paramètre reçoivent un identifiant réel, lu dans la page qui
 * les liste ; sans identifiant, elles sont ouvertes avec un UUID nul et doivent
 * répondre 404 proprement, jamais 500.
 */

const STATIQUES = [
  '/', '/annees', '/comptes', '/comptes/creer', '/comptes/parents',
  '/comptes/professeurs', '/comptes/staff', '/derogations', '/evening', '/evening/professeurs',
  // Nour facture « par famille » : /frais y répond 200 avec « indisponible », jamais 500.
  '/frais',
  '/finance', '/finance/administrateurs', '/finance/depenses', '/finance/dettes',
  '/finance/impayes', '/finance/rapport', '/finance/revenue', '/finance/staff', '/homework',
  '/journal', '/messages', '/notes',
  // Les absences du personnel (ADR-0074) : ses trois onglets.
  '/personnel/absences', '/personnel/absences?vue=mois', '/personnel/absences?vue=horaires',
  '/platform', '/prof', '/prof/classes',
  '/prof/emploi', '/prof/exercice', '/prof/notes', '/prof/remarques', '/profile', '/re-enrol', '/re-enrol/bulk',
  '/requests', '/scolarite', '/scolarite/absence', '/scolarite/emploi',
  '/scolarite/exclusions', '/scolarite/groupes', '/scolarite/niveaux', '/scolarite/notes',
  '/search', '/statistiques', '/students/new',
];

const NUL = '00000000-0000-7000-8000-000000000000';
const PARAMETREES = [
  '/finance/[guardianId]',
  '/finance/recu/[paymentId]',
  '/finance/recu/annuel/[id]',
  '/evening/recu/[id]',
  '/evening/recu-prof/[id]',
  '/notes/bulletin/[studentId]',
  '/notes/bulletins/[groupId]',
];

test.use({ storageState: 'e2e/.auth/nour-admin.json' });

async function ouvrir(page: Page, chemin: string, attendu: number[]) {
  const erreurs: string[] = [];
  // ⚠ ON JUGE LES RÉPONSES, PAS LE TEXTE DE LA CONSOLE. La console du serveur
  // de développement porte du bruit qui n'existe pas en production — la socket
  // HMR, des 404 de morceaux périmés — et faisait échouer chaque page pour
  // rien. Ce qui compte : une exception dans la page, ou une ressource que la
  // page a demandée et qui a répondu 4xx/5xx.
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`));
  // ⚠ UN <form> DANS UN <form> EST INVISIBLE ET MORTEL : le navigateur jette
  // l'intérieur, son bouton soumet l'extérieur — « Notifier les impayés »
  // ne marchait « pas du tout » pour cette seule raison (20/09). React le dit
  // dans la console au moment de l'hydratation ; on l'écoute ici.
  page.on('console', (m) => {
    if (m.type() === 'error' && /cannot be a descendant of|cannot contain a nested|Hydration failed/i.test(m.text())) {
      erreurs.push(`console: ${m.text().slice(0, 160)}`);
    }
  });
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() >= 400 && !/fonts\.g(oogleapis|static)\.com|hot-update|webpack-hmr/.test(url)) {
      erreurs.push(`${r.status()} ${url}`);
    }
  });

  const reponse = await page.goto(`http://nour.localhost:3000${chemin}`, { waitUntil: 'networkidle' });
  expect(reponse, chemin).not.toBeNull();
  expect(attendu, `${chemin} → ${reponse!.status()}`).toContain(reponse!.status());

  const texte = await page.locator('body').innerText();
  expect(texte, chemin).not.toMatch(/Application error|Internal Server Error|Unhandled Runtime/i);

  // La page elle-même peut légitimement répondre 404 (identifiant inconnu) :
  // on ne compte que les ressources qu'elle a demandées ensuite.
  const secondaires = erreurs.filter((e) => !e.endsWith(`http://nour.localhost:3000${chemin}`));
  expect(secondaires, `${chemin} : ressources en erreur`).toEqual([]);
}

for (const chemin of STATIQUES) {
  test(`${chemin} s’ouvre sans erreur`, async ({ page }) => {
    await ouvrir(page, chemin, [200]);
  });
}

for (const gabarit of PARAMETREES) {
  test(`${gabarit} répond 404 proprement à un identifiant inconnu`, async ({ page }) => {
    await ouvrir(page, gabarit.replace(/\[[^\]]+\]/, NUL), [404, 200]);
  });
}

test('les routes paramétrées s’ouvrent avec de vrais identifiants', async ({ page }) => {
  // ⚠ La liste des élèves n'a pas de lien par élève — comme chez El Ourwa, on y
  // entre par le bulletin ou par la famille. Les identifiants réels se lisent
  // sur « Notes des étudiants » (`notes_etudiants.php`, son mode « Résultats » :
  // un groupe, un trimestre → « Voir bulletin » par élève et « Bulletins de la
  // classe ») et sur /finance (une famille).
  await page.goto('http://nour.localhost:3000/scolarite/notes', { waitUntil: 'networkidle' });
  await page.locator('select#groupe_id').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Afficher les résultats' }).click();
  await page.waitForLoadState('networkidle');
  const liens = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const studentId = liens.map((h) => h.match(/\/notes\/bulletin\/([0-9a-f-]{36})/)?.[1]).find(Boolean);
  const groupId = liens.map((h) => h.match(/\/notes\/bulletins\/([0-9a-f-]{36})/)?.[1]).find(Boolean);
  expect(studentId, 'un bulletin d’élève sur /scolarite/notes').toBeTruthy();
  expect(groupId, 'une classe sur /scolarite/notes').toBeTruthy();
  await ouvrir(page, `/notes/bulletin/${studentId}?trimestre=1`, [200]);
  await ouvrir(page, `/notes/bulletins/${groupId}?trimestre=1`, [200]);

  await page.goto('http://nour.localhost:3000/finance', { waitUntil: 'networkidle' });
  const familles = await page.locator('a[href*="/finance/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const guardianId = familles.map((h) => h.match(/\/finance\/([0-9a-f-]{36})$/)?.[1]).find(Boolean);
  expect(guardianId, 'une famille sur /finance').toBeTruthy();
  await ouvrir(page, `/finance/${guardianId}`, [200]);

  // Un reçu réel, depuis la page de la famille — le document qu'une famille garde.
  const recus = await page.locator('a[href*="/finance/recu/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const recu = recus.find((h) => /\/finance\/recu\/(annuel\/)?[0-9a-f-]{36}/.test(h));
  if (recu) await ouvrir(page, recu, [200]);
});

/**
 * LE PROFESSEUR, SUR SES PAGES — le directeur les ouvre vides (il n'enseigne
 * rien) ; seul un vrai professeur exerce la liste de ses classes, la feuille de
 * notes, l'exercice et les remarques. Chaque page doit répondre 200 sans
 * erreur, et la feuille de notes doit s'ouvrir sur un de SES enseignements.
 */
test.describe('le professeur', () => {
  test.use({ storageState: 'e2e/.auth/nour-prof.json' });

  for (const chemin of ['/prof', '/prof/classes', '/prof/emploi', '/prof/exercice', '/prof/notes', '/prof/remarques', '/profile']) {
    test(`${chemin} s’ouvre pour un professeur`, async ({ page }) => {
      await ouvrir(page, chemin, [200]);
    });
  }

  test('la feuille de notes s’ouvre sur un enseignement du professeur', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/prof/notes', { waitUntil: 'networkidle' });
    const options = page.locator('select#enseignement_id option[value]:not([value=""])');
    expect(await options.count(), 'au moins un enseignement').toBeGreaterThan(0);
    const id = await options.first().getAttribute('value');
    await ouvrir(page, `/prof/notes?enseignement_id=${id}&trimestre=1`, [200]);
    expect(await page.locator('input[name^="examens["]').count(), 'des élèves dans la feuille').toBeGreaterThan(0);
  });
});
