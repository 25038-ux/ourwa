import { expect, test as setup } from '@playwright/test';

/**
 * Sign in once per role, and save the session for the tests to reuse.
 *
 * Two reasons this is a setup project rather than a helper called per test:
 *
 *  1. Speed and honesty. Logging in inside every test measures Next's dev-mode
 *     first-hit compilation, not the feature under test — which is what made
 *     the suite look broken when it was merely slow.
 *  2. The login endpoint is rate-limited on purpose (5 failures / 15 min, by
 *     account AND by IP). A suite that logs in dozens of times is arguing with
 *     a security control that is doing its job.
 *
 * The login FORM itself is still covered — by `login.spec.ts`, once.
 */

const ACCOUNTS = [
  { file: 'nour-admin.json', slug: 'nour', user: 'admin' },
  { file: 'nour-comptable.json', slug: 'nour', user: 'comptable' },
  { file: 'nour-prof.json', slug: 'nour', user: 'prof1' },
  { file: 'rissala-admin.json', slug: 'rissala', user: 'admin' },
  { file: 'salam-admin.json', slug: 'salam', user: 'admin' },
  // L'école « services » de développement (`pnpm --filter @elourwa/db seed:jinan`).
  { file: 'jinan-admin.json', slug: 'jinan', user: 'admin' },
  { file: 'jinan-absence.json', slug: 'jinan', user: 'absence' },
  { file: 'jinan-secretaire.json', slug: 'jinan', user: 'secretaire' },
];

for (const account of ACCOUNTS) {
  setup(`authenticate ${account.slug}/${account.user}`, async ({ page }) => {
    await page.goto(`http://${account.slug}.localhost:3000/login`);
    await page.getByLabel('Identifiant').fill(`${account.user}@${account.slug}.test`);
    // `exact` because El Ourwa's show/hide eye is aria-labelled "Afficher/masquer
    // le mot de passe" — a substring match resolves to both it and the field.
    // The aria-label is right for a screen reader; the locator was wrong.
    await page.getByLabel('Mot de passe', { exact: true }).fill('dev12345');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // Generous: the first hit on each route compiles it in dev mode. Each role
    // lands on ITS first page (his `url_tableau_bord()`): the administration on
    // « Tableau de bord », the accountant on « Finance » — so wait for the
    // page's own heading rather than one title.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });

    await page.context().storageState({ path: `e2e/.auth/${account.file}` });
  });
}
