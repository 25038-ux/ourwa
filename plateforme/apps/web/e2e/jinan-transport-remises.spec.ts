import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * LE TRANSPORT, LA PHOTOCOPIE OBLIGATOIRE, LES REMISES — demande du
 * propriétaire de Jinan (04/10/2026), ADR-0079. Sur l'école de développement
 * `jinan` (seed:jinan : transport 1 200 / mois, photocopie 700).
 *
 *   1. inscrire avec le transport coché : la photocopie vient d'office ;
 *   2. la fiche : une remise de 200 / mois sur le transport, puis l'arrêter ;
 *      la photocopie n'a pas de bouton « Arrêter » ;
 *   3. « + Ajouter un service » : le transport revient, plus tard.
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const J = 'http://jinan.localhost:3000';
const TAG = String(Date.now()).slice(-6);

test.describe.configure({ mode: 'serial' });

async function prete(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

test.describe('Jinan — transport et remises', () => {
  test.use({ storageState: DIRECTION });
  let fiche = '';

  test('inscrire avec le transport : la photocopie vient d’office', async ({ page }) => {
    await prete(page, `${J}/students/new`);
    await page.locator('input[name="prenom"]').fill('Bus');
    await page.locator('input[name="nom"]').fill(`Mint Transport ${TAG}`);
    const groupe = await page.locator('select[name="groupe_id"] option', { hasText: '1 AF — 1 AF B' }).first().getAttribute('value');
    await page.locator('select[name="groupe_id"]').selectOption(groupe!);
    await page.getByLabel(/8h – 14h/).check();
    await page.getByRole('checkbox', { name: 'Transport' }).check();
    await page.getByRole('radio', { name: 'Nouveau parent' }).check();
    await page.locator('input[name="p_nom"]').fill(`Parent Transport ${TAG}`);
    await page.locator('input[name="p_tel"]').fill(`4${TAG}9`);
    await page.getByRole('button', { name: /Inscrire l.étudiant/ }).click();

    const fenetre = page.locator('.modal-overlay.active');
    // Octobre 3 000 + inscription 2 000 + photocopie 700 + transport d'octobre 1 200
    // + plateforme d'octobre 200 (d'office — 0050).
    await expect(fenetre.locator('tfoot')).toContainText('1 mois + 4 services', { timeout: 60000 });
    await expect(fenetre.locator('tfoot')).toContainText('7 100 MRU');
    await expect(fenetre).toContainText('Transport');
    await fenetre.getByRole('button', { name: /Encaisser & imprimer/ }).click();
    await expect(page).toHaveURL(/\/finance\/recu\/groupe\//, { timeout: 60000 });
    fiche = (await page.getByRole('link', { name: /Profil du correspondant/ }).getAttribute('href'))!;
  });

  test('la fiche : remise sur le transport, photocopie sans « Arrêter », arrêter puis rajouter', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await prete(page, `${J}${fiche}`);
    const transport = page.getByTestId('abonnement-transport');
    await expect(transport).toContainText('1 200 MRU / mois');

    // La photocopie : obligatoire, elle s'exempte mais ne s'arrête pas.
    const photocopie = page.getByTestId('abonnement-photocopie');
    await expect(photocopie).toContainText('obligatoire');
    await expect(photocopie.getByRole('button', { name: 'Arrêter' })).toHaveCount(0);
    await expect(photocopie.getByRole('button', { name: 'Exempter' })).toBeVisible();

    // Une remise de 200 par mois.
    await transport.getByLabel('Remise par mois sur Transport').fill('200');
    await transport.getByRole('button', { name: 'Remise / mois' }).click();
    await expect(page.getByText(/Transport : remise de 200 MRU par mois \(\d+ mois non réglés réévalués\)/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('remise-transport')).toContainText('1 000');

    // L'arrêter à partir du dernier mois proposé.
    const depuis = transport.getByLabel(/Arrêter Transport à partir de/);
    const dernier = await depuis.locator('option').last().getAttribute('value');
    await depuis.selectOption(dernier!);
    await transport.getByRole('button', { name: 'Arrêter' }).click();
    await expect(page.getByText(/Transport arrêté à partir de/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('abonnement-transport')).toContainText('Arrêté');

    // Et le rajouter : « + Ajouter un service ».
    await page.getByRole('button', { name: '+ Ajouter un service' }).first().click();
    await page.getByLabel('Service à ajouter').selectOption('transport');
    // À partir du mois d'arrêt : les mois d'avant restent ceux du premier abonnement.
    await page.getByLabel('À partir de').selectOption(dernier!);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByText(/Transport ajouté/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('abonnement-transport')).toHaveCount(2);
  });
});
