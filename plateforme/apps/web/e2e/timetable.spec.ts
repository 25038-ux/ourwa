import { test, expect } from './session';

/**
 * The timetable, the expulsion register and a teacher's own week.
 *
 * The API suite proves the rules. This proves the screens carry them: that a
 * refusal is visible, and that a teacher's page cannot be pointed at somebody
 * else.
 *
 * ⚠ THE ROUTES AND HEADINGS MOVED with the UI replica, and these locators moved
 * with them. `/timetable` and `/expulsions` were mine; El Ourwa reaches both
 * through the Scolarité hub, and its page header is the h1 — the duplicate h2
 * these tests used to find is gone on purpose.
 */

const DIRECTOR = 'e2e/.auth/nour-admin.json';
const ACCOUNTANT = 'e2e/.auth/nour-comptable.json';

const EMPLOI = 'http://nour.localhost:3000/scolarite/emploi';
const EXCLUSIONS = 'http://nour.localhost:3000/scolarite/exclusions';

test.describe('the weekly timetable', () => {
  test.use({ storageState: DIRECTOR });

  test('renders his three exclusive steps, then SEVEN days and three slots', async ({ page }) => {
    await page.goto(EMPLOI);

    // The hub's heading is the only one: `layout_header.php` returns before
    // the page-header when `?embed=1`, and the hub loads every tab that way.
    await expect(
      page.getByRole('heading', { name: 'Gestion de scolarité', level: 1 }),
    ).toBeVisible();

    // ⚠ ÉTAPE 1 seule : his `niveau_id` select submits on change, and nothing
    // else is on the page until a level is chosen.
    await expect(page.getByText('Étape 1 : Sélectionner un niveau')).toBeVisible();
    await expect(page.getByText('Étape 2 : Sélectionner un groupe')).toHaveCount(0);
    await page.locator('select[name="niveau_id"]').selectOption({ index: 1 });

    // ÉTAPE 2 : the level's groups as buttons, and a way back.
    await expect(page.getByText('Étape 2 : Sélectionner un groupe')).toBeVisible();
    await expect(page.getByRole('link', { name: '← Changer de niveau' })).toBeVisible();
    await page.locator('a.btn-primary[href*="groupe_id="]').first().click();

    // ÉTAPE 3 : his `edt-grille` — SEVEN day columns after the time column
    // (Sunday included: `emplois_du_temps.jour` is an ENUM of seven), three
    // rows labelled with his slot names.
    const headers = page.locator('table.edt-grille thead th');
    await expect(headers).toHaveCount(8);
    await expect(headers.nth(3)).toHaveText('Mercredi');
    await expect(headers.nth(7)).toHaveText('Dimanche');
    await expect(page.locator('table.edt-grille tbody tr')).toHaveCount(3);
    await expect(page.locator('table.edt-grille tbody th').first()).toHaveText('8h-9h45');
  });
});

test.describe('the expulsion register', () => {
  test.use({ storageState: DIRECTOR });

  test('is titled in El Ourwa’s own words, half-English and all', async ({ page }) => {
    // "Liste des Expelled" is what the office reads. Translating it would be
    // tidier and would be a different product.
    await page.goto(EXCLUSIONS);
    // ⚠ « Liste des Expelled » EST SON TITRE ET N'EST JAMAIS AFFICHÉ dans le
    // hub — `expelled.php?embed=1` ne rend aucun <h1>. Ce que le bureau lit,
    // c'est le titre de la coquille, et l'en-tête de tableau « ⚠ Étudiants
    // expulsés ». C'est celui-là qu'il faut tenir, mi-anglais compris.
    await expect(
      page.getByRole('heading', { name: 'Gestion de scolarité', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Étudiants expulsés/ })).toBeVisible();
  });

  /**
   * `expelled.php` fait `SELECT * FROM expulsions ... ORDER BY date_expulsion
   * DESC` — et sa table ne peut contenir aucune ligne levée : « Débloquer »
   * fait `DELETE FROM expulsions`. Sa page est la liste des personnes
   * actuellement bloquées, six colonnes et un bouton. Nos lignes levées sont
   * marquées, pas effacées (écart assumé), et ne s'affichent pas ici ; le
   * journal garde le déblocage, comme son `journaliser()`.
   */
  test("⚠ la vue est la sienne : les blocages ACTIFS, six colonnes", async ({ page }) => {
    await page.goto(EXCLUSIONS);
    await expect(page.locator('thead th')).toHaveCount(6);
    await expect(page.locator('tbody tr.is-lifted')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /blocages levés/i })).toHaveCount(0);
  });

  test("⚠ six colonnes, pas neuf — et l'identité en <code>", async ({ page }) => {
    /**
     * Quatre choses avaient été inventées dans ces cellules : une pastille
     * « levé »/« bloqué » à côté de chaque nom, une signature « par X · levé le
     * … » sous la date, le motif de levée cité sous le motif, et un paragraphe
     * expliquant que l'inscription vérifie le registre elle-même. Chacune se
     * défendait ; ensemble elles faisaient six colonnes portant neuf faits.
     */
    await page.goto(EXCLUSIONS);
    await expect(page.locator('thead th')).toHaveCount(6);

    const premiere = page.locator('tbody tr').first();
    // NNI et RIM : deux nombres qu'on compare à l'œil, donc en chasse fixe.
    await expect(premiere.locator('code')).toHaveCount(2);
    await expect(premiere).not.toContainText('bloqué');
    await expect(premiere).not.toContainText('par ');
  });

  test('searches by NNI as well as by name', async ({ page }) => {
    await page.goto(EXCLUSIONS);
    const first = page.locator('tbody tr').first();
    const nni = (await first.locator('code').first().innerText()).trim();

    await page.getByLabel('Rechercher').fill(nni);
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText(nni);
  });
});

test.describe('a teacher sees their own week and nobody else’s', () => {
  test.use({ storageState: DIRECTOR });

  test('renders the page from the token, with no id to point elsewhere', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/prof/emploi');
    // Its own title, from `pages/professeur/emploi.php`: "Mon emploi du temps",
    // with the teacher's own name beneath it.
    await expect(
      page.getByRole('heading', { name: 'Mon emploi du temps', level: 1 }),
    ).toBeVisible();
    // There is deliberately no teacher parameter to tamper with: the URL cannot
    // name a colleague, so the page cannot be pointed at one.
    await expect(page).toHaveURL(/\/prof\/emploi$/);
  });
});

test.describe('permissions still shape what is offered', () => {
  test.use({ storageState: ACCOUNTANT });

  test('an accountant gets the register — they enrol, so they must know', async ({ page }) => {
    // The accountant holds `scolarite.inscrire` and `scolarite.reinscrire`, so
    // they admit children. The people who admit are exactly the people who need
    // to know who may not be admitted; the register is deliberately theirs.
    await page.goto(EXCLUSIONS);
    await expect(page.getByRole('heading', { name: /Étudiants expulsés/ })).toBeVisible();
  });

  test('but not the timetable, which is nothing to do with money', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/');
    await expect(page.getByRole('link', { name: 'Emploi du temps' })).toHaveCount(0);
    // And the page itself refuses: hiding a link is not the boundary.
    await page.goto(EMPLOI);
    // Son `require_staff_admin()` ; ici la permission que ces rôles portent.
    await expect(page.getByText(/Cette page demande/).first()).toBeVisible();
    await expect(page.locator('select[name="niveau_id"]')).toHaveCount(0);
  });
});
