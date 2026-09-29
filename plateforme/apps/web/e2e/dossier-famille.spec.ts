import { test, expect } from './session';

/**
 * Le dossier de la famille (20/09) : corriger le correspondant et la fiche
 * d'un enfant sur place ; encaisser plusieurs mois d'un coup, un seul reçu.
 */
const DIRECTOR = 'e2e/.auth/nour-admin.json';

test.describe('le dossier de la famille', () => {
  test.use({ storageState: DIRECTOR });

  test('corriger la fiche d’un enfant et le nom du correspondant', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/finance');
    await page.locator('a[href^="/finance/01"]').first().click();
    await expect(page.getByRole('button', { name: /Modifier le correspondant/ })).toBeVisible({ timeout: 30000 });

    // La fiche de l'enfant : un prénom corrigé se lit dans le titre du bloc.
    await page.getByRole('button', { name: /^✎ Fiche de / }).first().click();
    const prenom = page.locator('#df-prenom');
    await expect(prenom).toBeVisible();
    const original = await prenom.inputValue();
    await prenom.fill(`${original}-E2E`);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/Fiche de .*-E2E .* mise à jour\./)).toBeVisible({ timeout: 30000 });
    // … et on remet le prénom d'origine.
    await page.getByRole('button', { name: /^✎ Fiche de / }).first().click();
    await page.locator('#df-prenom').fill(original);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/mise à jour\./)).toBeVisible({ timeout: 30000 });

    // Le correspondant : un numéro qui n'est pas mauritanien est refusé, en le disant.
    await page.getByRole('button', { name: /Modifier le correspondant/ }).click();
    await page.locator('#df-tel').fill('0033612345678');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/numéro mauritanien|8 chiffres/i)).toBeVisible({ timeout: 30000 });
  });

  test('cocher deux mois et encaisser : un seul reçu, deux mois dessus', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/finance');
    // Une famille avec des mois dus : le filtre « impayés » en donne.
    await page.goto('http://nour.localhost:3000/finance?impaye_mois=12&impaye_annee=2025');
    await page.locator('a[href^="/finance/01"]').first().click();
    const cases = page.locator('input[title^="Cocher pour l\'encaisser"]');
    await expect(cases.first()).toBeVisible({ timeout: 30000 });
    await cases.nth(0).check();
    await cases.nth(1).check();
    await page.getByRole('button', { name: /Encaisser la sélection — 2 mois/ }).click();
    const modale = page.locator('.modal-overlay.active');
    await expect(modale.getByText(/Total à encaisser \(2 mois/)).toBeVisible();
    // Les frais annuels se décochent : ils ne sont jamais obligatoires.
    const frais = modale.locator('input[name^="frais_"]');
    for (let i = 0; i < (await frais.count()); i++) {
      const c = frais.nth(i);
      if (await c.isEnabled() && await c.isChecked()) await c.click({ force: true });
    }
    await expect(modale.getByText(/Total à encaisser \(2 mois\)/)).toBeVisible();
    await modale.locator('input[placeholder="N° reçu appli (facultatif)"]').first().fill('E2E-REF-1');
    await modale.getByRole('button', { name: /Encaisser & imprimer/ }).click();
    await expect(page).toHaveURL(/\/finance\/recu\/groupe\//, { timeout: 30000 });
    await expect(page.getByText('REÇU DE PAIEMENT — SCOLARITÉ ET FRAIS')).toBeVisible();
    await expect(page.getByText(/réf\. E2E-REF-1/)).toBeVisible();
    const scolarite = await page.getByText(/^Scolarité — /).locator('..').innerText();
    expect((scolarite.match(/\d{4} : /g) ?? []).length).toBe(2);
  });
});
