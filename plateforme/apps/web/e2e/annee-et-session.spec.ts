import { test, expect } from './session';

/**
 * TWO CONTROLS THAT MOVED THE URL AND CHANGED NOTHING.
 *
 * Both defects were invisible to every other kind of test. The pages rendered,
 * returned 200, and showed plausible data; the API suite proved the rules; the
 * type checker was satisfied. What was wrong was that a control on the screen
 * did not do the thing it appeared to do — and only a browser can see that.
 *
 * ⚠ THE YEAR SELECTOR IS ON EVERY PAGE and no page read it. `PageHeader`
 * renders it, it writes `?annee_id=`, and nothing anywhere consumed that — not
 * even the header itself, which computed its selected option as "the active
 * year" and ignored the URL. Choose 2024-2025, watch the page reload identical
 * with the box snapped back. That is what makes it look broken rather than
 * merely inert.
 *
 * ⚠ LE LIBRE-SERVICE DE MOT DE PASSE A ÉTÉ RETIRÉ (propriétaire, 2026-09-04) :
 * seul un super administrateur réinitialise un mot de passe. Ce fichier a
 * longtemps couvert ses trois défauts imbriqués — page injoignable, `/reset`
 * jamais construit, appel à l'API depuis le navigateur que notre propre CSP
 * bloquait. Il ne reste que la garde qui vérifie qu'ils ne reviennent pas.
 */

const DIRECTOR = 'e2e/.auth/nour-admin.json';
const BASE = 'http://nour.localhost:3000';

test.describe('le sélecteur d’année', () => {
  test.use({ storageState: DIRECTOR });

  test('⚠ actually changes what the page counts, and stays where it was put', async ({
    page,
  }) => {
    await page.goto(`${BASE}/scolarite/groupes`);

    const selector = page.locator('select[name="annee_id"]');
    await expect(selector).toBeVisible();

    // The year the page opens on, and what it counts there.
    const opened = await selector.inputValue();
    const thisYear = await page.locator('table tbody tr').first().innerText();

    // A closed year the seed never enrolled anyone into.
    const closed = page.locator('select[name="annee_id"] option', {
      hasText: 'clôturée',
    });
    const closedValue = await closed.first().getAttribute('value');
    expect(closedValue).not.toBe(opened);

    await selector.selectOption(closedValue!);
    await page.waitForURL(/annee_id=/);

    // ⚠ THE BOX STAYS ON WHAT WAS CHOSEN. It used to snap back to the active
    // year, because the header recomputed it and never read the URL.
    await expect(page.locator('select[name="annee_id"]')).toHaveValue(closedValue!);

    // ⚠ AND THE PAGE COUNTS THAT YEAR. Before, the figures were identical
    // whichever year was picked — the operator could read this year's arrears
    // believing they were last year's.
    await expect(page.locator('table tbody tr').first()).not.toHaveText(thisYear);
  });
});

test.describe('mot de passe oublié — il n’y en a plus', () => {
  /**
   * ⚠ CINQ TESTS ONT DISPARU AVEC LE LIBRE-SERVICE, et ce qu'ils tenaient vaut
   * d'être écrit : le lien depuis la connexion, la réponse identique que le
   * compte existe ou non, un `/reset` qui existe vraiment, le refus d'un mot de
   * passe faible avant le serveur, et un lien sans jeton nommé comme tel.
   *
   * Décision du propriétaire (2026-09-04) : seul un SUPER administrateur
   * réinitialise un mot de passe, depuis « Comptes du personnel » ou « Comptes
   * des parents ». El Ourwa n'a pas de libre-service non plus.
   *
   * Ce qui reste ici est la garde : que rien ne les fasse revenir sans qu'on le
   * remarque.
   */
  test('⚠ la page de connexion n’offre aucune sortie de secours', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole('link', { name: /oubli/i })).toHaveCount(0);
  });

  test('⚠ /forgot et /reset ne répondent plus', async ({ page }) => {
    for (const chemin of ['/forgot', '/reset']) {
      const reponse = await page.goto(`${BASE}${chemin}`);
      expect(reponse?.status()).toBe(404);
    }
  });
});
