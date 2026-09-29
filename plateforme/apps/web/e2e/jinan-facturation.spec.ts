import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * LA FACTURATION « SERVICES » (Jinan) DANS LE NAVIGATEUR — ADR-0073,
 * docs/specs/jinan-facturation.md §7–§9.
 *
 * Sur l'école de développement `jinan` (`pnpm --filter @elourwa/db seed:jinan`,
 * relancée par scripts/e2e-run.sh avant chaque passage) : quatre niveaux aux
 * tarifs 8h – 14h / 8h – 17h, les six prix des services, trois familles
 * inscrites et une à réinscrire. Tout y est inventé.
 *
 * Et, à la fin, la contre-épreuve : une école « famille » (Nour) ne voit rien
 * de tout cela.
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const J = 'http://jinan.localhost:3000';

test.describe.configure({ mode: 'serial' });

/** Un identifiant qui change à chaque passage : RIM, NNI, téléphone uniques. */
const TAG = String(Date.now()).slice(-6);
let familleUrl = '';

async function prete(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

test.describe('Jinan — la direction', () => {
  test.use({ storageState: DIRECTION });

  test('la page « Frais » enregistre un prix et un tarif', async ({ page }) => {
    await prete(page, `${J}/frais`);
    await expect(page.getByRole('heading', { name: 'Tarifs des niveaux' })).toBeVisible();
    await expect(page.locator('.sidebar-nav a[href="/frais"]')).toBeVisible();
    // Le prix du docteur : 500 → 550, puis retour à 500.
    const ligne = page.locator('tr', { hasText: 'Docteur' });
    const champ = ligne.locator('input[type="number"]');
    await champ.fill('550');
    await champ.press('Enter');
    await expect(page.getByText(/550 MRU/).first()).toBeVisible({ timeout: 30000 });
    await page.locator('tr', { hasText: 'Docteur' }).locator('input[type="number"]').fill('500');
    await page.locator('tr', { hasText: 'Docteur' }).locator('input[type="number"]').press('Enter');
    await expect(page.getByText(/500 MRU/).first()).toBeVisible({ timeout: 30000 });
  });

  test('inscrire avec un mode et des services : un seul reçu pour la scolarité et les services', async ({ page }) => {
    await prete(page, `${J}/students/new`);
    await page.locator('input[name="prenom"]').fill('Essai');
    await page.locator('input[name="nom"]').fill(`Mint Jinan ${TAG}`);
    await page.locator('input[name="rim"]').fill(`RIM-E2E-${TAG}`);
    await page.locator('input[name="nni"]').fill(`NNIE2E${TAG}`);
    // « 1 AF — 1 AF A (n/30) » : l'effectif change d'un passage à l'autre.
    const groupe = await page.locator('select[name="groupe_id"] option', { hasText: '1 AF — 1 AF A' }).first().getAttribute('value');
    await page.locator('select[name="groupe_id"]').selectOption(groupe!);
    // Le mode est obligatoire, et la mensualité suit le niveau ET le mode.
    await page.getByLabel(/8h – 17h/).check();
    await expect(page.locator('#frais_mensuel')).toHaveValue('4500');
    await page.getByLabel(/8h – 14h/).check();
    await expect(page.locator('#frais_mensuel')).toHaveValue('3000');
    await page.getByLabel(/8h – 17h/).check();
    await expect(page.getByTestId('frais-inscription')).toContainText('2 000 MRU');
    await page.getByLabel(/Cantine — déjeuner/).check();
    await page.getByRole('checkbox', { name: 'Piscine' }).check();
    await page.getByRole('radio', { name: 'Nouveau parent' }).check();
    await page.locator('input[name="p_nom"]').fill(`Parent Jinan ${TAG}`);
    await page.locator('input[name="p_tel"]').fill(`47${TAG}`);
    await page.getByRole('button', { name: /Inscrire l.étudiant/ }).click();

    const fenetre = page.locator('.modal-overlay.active');
    await expect(fenetre.getByText('Services 2025-2026')).toBeVisible({ timeout: 60000 });
    // Octobre (4 500) + inscription (2 000) + cantine d'octobre (1 500) + piscine d'octobre (1 000).
    await expect(fenetre.locator('tfoot')).toContainText('1 mois + 3 services');
    await expect(fenetre.locator('tfoot')).toContainText('9 000 MRU');
    await fenetre.getByRole('button', { name: /Encaisser & imprimer/ }).click();
    await expect(page).toHaveURL(/\/finance\/recu\/groupe\//, { timeout: 60000 });
    const recu = page.locator('#recu');
    await expect(recu).toContainText('Reçu de paiement — Scolarité et services');
    await expect(recu).toContainText(/JIN-\d{4}-\d{5}/);
    await expect(recu).toContainText('Cantine — déjeuner');
    await expect(recu).toContainText('Piscine');
    await expect(recu).toContainText("Frais d'inscription");
    await expect(recu).toContainText('9 000');
    // Le lien de retour mène à la fiche de la famille.
    familleUrl = (await page.getByRole('link', { name: /Profil du correspondant/ }).getAttribute('href'))!;
    expect(familleUrl).toMatch(/^\/finance\/[0-9a-f-]{36}$/);
  });

  test('la fiche : mode, services, sous-lignes de mois ; annuler un paiement de service', async ({ page }) => {
    await prete(page, `${J}${familleUrl}`);
    // Pas de « Frais annuels » par famille dans une école « services ».
    await expect(page.getByRole('heading', { name: 'Frais annuels' })).toHaveCount(0);
    await expect(page.locator('.services-enfant').first()).toContainText('8h – 17h');
    await expect(page.getByTestId('abonnement-cantine_dejeuner')).toContainText('Actif');
    await expect(page.getByTestId('abonnement-piscine')).toBeVisible();
    await expect(page.getByTestId('abonnement-inscription')).toBeVisible();
    // Octobre : la cantine et la piscine réglées, avec leur reçu.
    const octobre = page.locator('.mois-card', { hasText: 'Octobre' }).first();
    await expect(octobre.locator('.service-ligne', { hasText: 'Cantine' })).toContainText('✓ Réglé');
    await expect(octobre.locator('.service-ligne', { hasText: 'Cantine' }).getByRole('link', { name: 'Reçu' })).toBeVisible();
    // La direction annule le paiement de la cantine d'octobre : la ligne redevient due.
    page.once('dialog', (d) => d.accept());
    await octobre.getByRole('button', { name: /Annuler le paiement : Cantine — déjeuner/ }).click();
    await expect(page.getByText('Paiement du service annulé.')).toBeVisible({ timeout: 30000 });
    await expect(
      page.locator('.mois-card', { hasText: 'Octobre' }).first().locator('.service-ligne', { hasText: 'Cantine' }),
    ).toContainText('Dû');
  });

  test('encaisser un service seul : un reçu « Services »', async ({ page }) => {
    await prete(page, `${J}${familleUrl}`);
    const novembre = page.locator('.mois-card', { hasText: 'Novembre' }).first();
    await novembre.getByRole('checkbox', { name: /Cantine — déjeuner — Novembre/ }).check();
    await page.getByRole('button', { name: /Encaisser la sélection — 1 service, 1 500 MRU/ }).click();
    const fenetre = page.locator('.modal-overlay.active');
    await expect(fenetre.locator('tfoot')).toContainText('0 mois + 1 service');
    await expect(fenetre.locator('tfoot')).toContainText('1 500 MRU');
    await fenetre.getByRole('button', { name: /Encaisser & imprimer/ }).click();
    await expect(page).toHaveURL(/\/finance\/recu\/groupe\//, { timeout: 60000 });
    await expect(page.locator('#recu')).toContainText('Reçu de paiement — Services');
    await expect(page.locator('#recu')).toContainText('Novembre 2025 : 1 500 MRU');
  });

  test('exempter, arrêter, ajouter un service, changer de mode', async ({ page }) => {
    await prete(page, `${J}${familleUrl}`);
    // Exempter la piscine, puis lever l'exemption.
    await page.getByTestId('abonnement-piscine').getByRole('button', { name: 'Exempter' }).click();
    await expect(page.getByText('Piscine : exempté.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('abonnement-piscine')).toContainText('Exempté');
    await page.getByTestId('abonnement-piscine').getByRole('button', { name: "Lever l'exemption" }).click();
    await expect(page.getByText('Piscine : exemption levée.')).toBeVisible({ timeout: 30000 });

    // Arrêter la piscine à partir de mai 2026 : les mois de mai et juin disparaissent.
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('abonnement-piscine').getByLabel(/Arrêter Piscine à partir de/).selectOption('2026-5');
    await page.getByTestId('abonnement-piscine').getByRole('button', { name: 'Arrêter' }).click();
    await expect(page.getByText('Piscine arrêté à partir de Mai 2026.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('abonnement-piscine')).toContainText('Arrêté');
    await expect(page.locator('.mois-card', { hasText: 'Juin' }).first().locator('.service-ligne', { hasText: 'Piscine' })).toHaveCount(0);

    // Ajouter le docteur.
    await page.getByRole('button', { name: '+ Ajouter un service' }).first().click();
    await page.getByLabel('Service à ajouter').selectOption('docteur');
    await page.getByLabel('À partir de', { exact: true }).selectOption('2026-1');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByText('Docteur ajouté à partir de Janvier 2026.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('abonnement-docteur')).toContainText('Actif');

    // Changer de mode : 8h – 17h → 8h – 14h.
    await page.getByRole('button', { name: 'Changer de mode' }).first().click();
    await page.getByLabel("Nouveau mode d'étude").selectOption('8h-14h');
    await page.getByRole('button', { name: 'Changer', exact: true }).click();
    await expect(page.getByText(/Mode d'étude changé : 8h – 14h/)).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.services-enfant').first()).toContainText('8h – 14h');
  });

  test('réinscrire avec un mode et un service', async ({ page }) => {
    await prete(page, `${J}/re-enrol?q=Vatimetou`);
    await page.getByRole('button', { name: 'Réinscrire', exact: true }).first().click();
    const modale = page.locator('[role="dialog"]').last();
    await modale.locator('select[name="nouveau_groupe_id"]').selectOption({ label: '2 AF — 2 AF A' });
    await modale.getByLabel(/8h – 14h/).check();
    await modale.getByRole('checkbox', { name: 'Docteur' }).check();
    await modale.getByRole('button', { name: 'Confirmer la réinscription' }).click();
    const fenetre = page.locator('.modal-overlay.active');
    // 3 200 (2 AF, 8h – 14h) + inscription 2 000 + docteur d'octobre 500.
    await expect(fenetre.locator('tfoot')).toContainText('5 700 MRU', { timeout: 60000 });
  });

  test('les impayés disent que les services sont dans la scolarité due', async ({ page }) => {
    await prete(page, `${J}/finance/impayes`);
    await expect(page.getByTestId('note-services')).toBeVisible();
  });
});

test.describe('une école « famille » ne voit rien de nouveau', () => {
  test.use({ storageState: 'e2e/.auth/nour-admin.json' });

  test('ni mode, ni services, ni « Frais » ; ses frais annuels par famille restent', async ({ page }) => {
    await prete(page, 'http://nour.localhost:3000/students/new');
    await expect(page.getByText("Mode d'étude")).toHaveCount(0);
    await expect(page.locator('.sidebar-nav a[href="/frais"]')).toHaveCount(0);
    await prete(page, 'http://nour.localhost:3000/finance');
    await page.locator('a[href^="/finance/01"]').first().click();
    await expect(page.getByRole('heading', { name: 'Frais annuels' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.services-enfant')).toHaveCount(0);
    await prete(page, 'http://nour.localhost:3000/finance/impayes');
    await expect(page.getByTestId('note-services')).toHaveCount(0);
  });
});
