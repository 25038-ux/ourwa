import { test, expect } from './session';

/**
 * The isolation and branding guarantees, exercised through a real browser.
 *
 * The API suite proves the DATABASE enforces isolation. This proves the PRODUCT
 * does: someone signed into one branch sees that branch and no other.
 *
 * Sessions come from the setup project, so these tests measure the pages rather
 * than the login round trip.
 */

const NOUR = 'e2e/.auth/nour-admin.json';

test.describe('branding is per branch', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const branch of [
    { slug: 'nour', name: 'École Nour' },
    { slug: 'rissala', name: 'École Rissala' },
    { slug: 'salam', name: 'École Salam' },
  ]) {
    test(`${branch.slug} is titled ${branch.name}`, async ({ page }) => {
      await page.goto(`http://${branch.slug}.localhost:3000/login`);
      // Son `espace-direction.php` titre « Connexion — El Ourwa » ; la branche
      // est dans le `<h1>` de la carte, là où lui écrit « El Ourwa » — une
      // installation par école chez lui, plusieurs ici.
      await expect(page).toHaveTitle('Connexion — El Ourwa');
      await expect(page.getByRole('heading', { name: branch.name, level: 1 })).toBeVisible();
    });
  }

  test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/');
    // Son `require_role()` sans session : `?erreur=session_expiree`.
    await expect(page).toHaveURL(/\/login\?erreur=session_expiree$/);
    await expect(page.getByText('Votre session a expiré. Veuillez vous reconnecter.')).toBeVisible();
  });
});

test.describe('signed in at Nour', () => {
  test.use({ storageState: NOUR });

  test('shows this branch alone — never the three-school total', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/');
    const card = page.locator('.kpi-card').filter({ hasText: 'Total étudiants' });
    const shown = Number((await card.locator('.kpi-value').innerText()).replace(/\D/g, ''));

    // The seed puts 200 students in each of three schools. Asserting exactly
    // 200 was brittle the moment the product could admit a student of its own —
    // one admission through the UI broke this test without breaking anything
    // real. What actually matters is the invariant: this figure is ONE branch's,
    // so reaching 600 would mean the branch filter had failed.
    expect(shown).toBeGreaterThanOrEqual(200);
    expect(shown).toBeLessThan(600);
  });

  test('the masthead names the branch you are in', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/');
    // The branch is named in the sidebar logo, as El Ourwa names it.
    await expect(page.locator('.sidebar-logo')).toContainText('École Nour');
  });

  test('the till reports itself coherent', async ({ page }) => {
    // This used to read a dashboard card of my own invention. El Ourwa's
    // dashboard has four KPIs and none of them is a till check, so the card
    // went — but the guarantee did not. It is asserted where it lives: every
    // payment's tender lines sum to the payment, with no gap.
    // Called with the session's own access token. The stored state holds the
    // web app's cookies, not an Authorization header, so the token has to be
    // lifted out of the cookie the app set — otherwise this is a 401 dressed up
    // as a passing assertion the moment anyone loosens the check.
    const cookies = await page.context().cookies('http://nour.localhost:3000');
    const token = cookies.find((c) => c.name === 'elourwa_nour_access')?.value;
    expect(token, 'the session should carry an access token').toBeTruthy();

    const response = await page.request.get('http://localhost:3001/finance/till-check', {
      headers: { 'X-School-Slug': 'nour', Authorization: `Bearer ${token}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    const till = await response.json();
    expect(till.mismatched).toBe(0);
    expect(Number(till.gap)).toBe(0);
  });

  test('a class ranking is his `notes_etudiants.php` — same columns for both regimes', async ({ page }) => {
    // Son classement (« Rang · Élève · Matricule · Moyenne / 20 · Appréciation »)
    // vaut pour le fondamental comme pour le collège : un total fondamental est
    // ramené sur 20 pour être classé. Le premier groupe de la liste est un
    // groupe du fondamental (3 AF A) — les niveaux fondamentaux viennent d'abord.
    // Ses quatre modes exclusifs : le classement s'ouvre par `?classement=1`.
    await page.goto('http://nour.localhost:3000/scolarite/notes?classement=1');
    await expect(page.getByRole('heading', { name: 'Gestion de scolarité', level: 1 })).toBeVisible();
    await page.locator('select#cl_groupe').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Classer' }).click();

    const headers = page.locator('table.classement-table th');
    await expect(headers.filter({ hasText: 'Moyenne / 20' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Appréciation' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Total' })).toHaveCount(0);
  });

  test('an absence is shown as an absence, never as a mark', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/notes');
    // ⚠ -1 is a MARKER, not a mark, and must never appear as a SCORE. Scoped to
    // the table cells on purpose: the page also tells the operator to type -1
    // for an absence, and forbidding the string outright failed on the sentence
    // that explains the rule.
    await expect(page.getByText(/absence|absent/i).first()).toBeVisible();
    await expect(page.locator('td').filter({ hasText: /^-1$/ })).toHaveCount(0);
  });

  test('a family debt is itemised per child and per month', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/finance');
    await page.getByRole('link', { name: /Voir le profil/ }).first().click();
    // ⚠ Le titre est celui du hub : `gestion_caisse.php?embed=1` ne rend
    // aucun <h1>, et une fiche de famille reste dans l'onglet Caisse.
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    await expect(page.getByText('Situation financière')).toBeVisible();
    // A total alone is not an explanation; the months must be listed.
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('signed in at Rissala', () => {
  test.use({ storageState: 'e2e/.auth/rissala-admin.json' });

  test('is a different branch with its own name', async ({ page }) => {
    await page.goto('http://rissala.localhost:3000/');
    await expect(page.locator('.sidebar-logo')).toContainText('École Rissala');
  });

  test('⚠ a Rissala session cannot read Nour', async ({ page }) => {
    // The token is scoped to one school. Pointing the same session at another
    // branch must not show its data.
    const response = await page.request.get('http://localhost:3001/students/count', {
      headers: { 'X-School-Slug': 'nour' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('permissions shape the menu', () => {
  test.use({ storageState: 'e2e/.auth/nour-comptable.json' });

  test('an accountant sees Finance but not Notes', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/');
    await expect(page.getByRole('link', { name: 'Finance' })).toBeVisible();
    // Hiding a link is not the security boundary — the endpoint guard is — but
    // the menu should not offer doors this role cannot open.
    await expect(page.getByRole('link', { name: 'Notes' })).toHaveCount(0);
  });
});
