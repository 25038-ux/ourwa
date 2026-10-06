import { test, expect } from './session';
import type { Locator, Page } from '@playwright/test';

/**
 * FRAIS DE PLATEFORME, FRAIS DE FOURNITURE, POURCENTAGES PROPOSÉS — demande du
 * propriétaire de Jinan (06/10/2026), ADR-0082. Sur l'école de développement
 * `jinan` (seed:jinan : plateforme 200 / mois, fournitures 1 500 / an).
 *
 *   1. la page « Frais » : la plateforme (chaque mois, obligatoire) et les
 *      fournitures (une fois par an, au choix) ;
 *   2. inscrire avec les fournitures cochées, le frais mensuel à −20 % d'un clic ;
 *   3. la fiche : la plateforme remisée à −20 % (liste) ; les fournitures,
 *      réglées, ne se retirent pas ;
 *   4. les fenêtres « Frais », « Réduction », « Accorder une remise » et la
 *      réinscription proposent 5 % … 50 % et calculent le montant.
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const J = 'http://jinan.localhost:3000';
const TAG = String(Date.now()).slice(-6);

test.describe.configure({ mode: 'serial' });
test.use({ storageState: DIRECTION });

async function prete(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/** « 25 % de 4 500 MRU (tarif plein) : 1 125 MRU retirés, reste 3 375 MRU. » → [base, part, reste]. */
async function resume(zone: Locator): Promise<[number, number, number]> {
  const t = await zone.getByTestId('pourcentage-resume').innerText();
  const m = /de ([\d\s  ]+) MRU.*: ([\d\s  ]+) MRU retirés, reste ([\d\s  ]+) MRU/.exec(t);
  expect(m, t).not.toBeNull();
  const n = (s: string) => Number(s.replace(/\D/g, ''));
  return [n(m![1]!), n(m![2]!), n(m![3]!)];
}

let fiche = '';

test('« Frais » : la plateforme chaque mois, obligatoire ; les fournitures une fois par an, au choix', async ({ page }) => {
  await prete(page, `${J}/frais`);
  const ligne = (t: string) => page.locator('tr', { hasText: t });
  await expect(ligne('Frais de plateforme')).toContainText('Chaque mois');
  await expect(ligne('Frais de plateforme')).toContainText('obligatoire');
  await expect(ligne('Frais de fourniture')).toContainText('Une fois par an');
  await expect(ligne('Frais de fourniture')).toContainText('au choix');
});

test('inscrire avec les fournitures ; le frais mensuel à −20 % d’un clic', async ({ page }) => {
  await prete(page, `${J}/students/new`);
  await page.locator('input[name="prenom"]').fill('Four');
  await page.locator('input[name="nom"]').fill(`Mint Fournitures ${TAG}`);
  const groupe = await page.locator('select[name="groupe_id"] option', { hasText: '3 AF — 3 AF A' }).first().getAttribute('value');
  await page.locator('select[name="groupe_id"]').selectOption(groupe!);
  await page.getByLabel(/8h – 14h/).check();
  const tarif = Number(await page.locator('#frais_mensuel').inputValue());
  expect(tarif).toBeGreaterThan(0);

  // −20 % : le champ reçoit 80 % du tarif, et la ligne dit le calcul.
  const zone = page.locator('.form-group', { has: page.locator('#frais_mensuel') });
  await expect(zone.getByRole('button', { name: /^\d+ %$/ })).toHaveCount(10);
  await zone.getByRole('button', { name: '20 %' }).click();
  const [base, part, reste] = await resume(zone);
  expect([base, part, reste]).toEqual([tarif, Math.round(tarif * 0.2), tarif - Math.round(tarif * 0.2)]);
  await expect(page.locator('#frais_mensuel')).toHaveValue(String(reste));

  await page.getByRole('checkbox', { name: 'Frais de fourniture' }).check();
  await page.getByRole('radio', { name: 'Nouveau parent' }).check();
  await page.locator('input[name="p_nom"]').fill(`Parent Fournitures ${TAG}`);
  await page.locator('input[name="p_tel"]').fill(`45${TAG}`);
  await page.getByRole('button', { name: /Inscrire l.étudiant/ }).click();

  const fenetre = page.locator('.modal-overlay.active');
  // Inscription, photocopie, plateforme (d'office) et fournitures (cochées).
  await expect(fenetre.locator('tfoot')).toContainText('1 mois + 4 services', { timeout: 60000 });
  await expect(fenetre).toContainText('Frais de fourniture');
  await expect(fenetre).toContainText('Frais de plateforme');
  await fenetre.getByRole('button', { name: /Encaisser & imprimer/ }).click();
  await expect(page).toHaveURL(/\/finance\/recu\/groupe\//, { timeout: 60000 });
  await expect(page.locator('#recu')).toContainText('Frais de fourniture');
  fiche = (await page.getByRole('link', { name: /Profil du correspondant/ }).getAttribute('href'))!;
});

test('la fiche : la plateforme se remise à −20 % ; les fournitures réglées ne se retirent pas', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await prete(page, `${J}${fiche}`);

  const plateforme = page.getByTestId('abonnement-plateforme');
  await expect(plateforme).toContainText('obligatoire');
  await expect(plateforme.getByRole('button', { name: 'Arrêter' })).toHaveCount(0);
  await plateforme.getByLabel('Réduction en pourcentage').selectOption('20');
  await expect(plateforme.getByLabel('Remise par mois sur Frais de plateforme')).toHaveValue('40');
  await plateforme.getByRole('button', { name: 'Remise / mois' }).click();
  await expect(page.getByText(/Frais de plateforme : remise de 40 MRU par mois/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('remise-plateforme')).toContainText('160');

  // Annuelles : pas de remise ; réglées, le retrait est refusé (annuler d'abord le paiement).
  const fournitures = page.getByTestId('abonnement-fourniture');
  await expect(fournitures.getByRole('button', { name: 'Remise / mois' })).toHaveCount(0);
  await fournitures.getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText(/« Frais de fourniture » est déjà réglé : annulez d'abord le paiement/)).toBeVisible({ timeout: 30000 });
});

test('« Frais », « Réduction », « Accorder une remise » : 5 % … 50 %, le montant calculé', async ({ page }) => {
  await prete(page, `${J}${fiche}`);

  // Modifier le frais mensuel : le pourcentage se prend sur le tarif plein.
  await page.getByTitle('Modifier le frais mensuel de cet étudiant').first().click();
  const frais = page.locator('#modal_frais');
  await expect(frais.getByRole('button', { name: /^\d+ %$/ })).toHaveCount(10);
  await frais.getByRole('button', { name: '25 %' }).click();
  const [, , resteFrais] = await resume(frais);
  await expect(frais.locator('input[name="amount"]')).toHaveValue(String(resteFrais));
  await expect(frais.getByTestId('pourcentage-resume')).toContainText('tarif plein');
  await frais.getByRole('button', { name: 'Annuler' }).click();

  // Réduction d'un mois : la part retirée, et le motif prérempli.
  await page.getByRole('button', { name: 'Réduction', exact: true }).first().click();
  const reduction = page.locator('#modal_reduction');
  await reduction.getByRole('button', { name: '10 %' }).click();
  const [, partReduction] = await resume(reduction);
  await expect(reduction.locator('input[name="amount"]')).toHaveValue(String(partReduction));
  await expect(reduction.locator('input[name="reason"]')).toHaveValue('Réduction de 10 %');
  await reduction.getByRole('button', { name: 'Annuler' }).click();

  // Remise sur la dette.
  await page.getByRole('button', { name: /Accorder une remise/ }).click();
  const bloc = page.locator('#bloc-remise');
  await bloc.getByRole('button', { name: '50 %' }).click();
  const [baseDette, partDette] = await resume(bloc);
  expect(partDette).toBe(Math.round(baseDette / 2));
  await expect(bloc.locator('input[name="amount"]')).toHaveValue(String(partDette));
  await expect(bloc.locator('input[name="reason"]')).toHaveValue('Réduction de 50 %');
});

test('la réinscription propose aussi les pourcentages sur le tarif du niveau', async ({ page }) => {
  await prete(page, `${J}/re-enrol?q=Vatimetou`);
  await page.getByRole('button', { name: 'Réinscrire', exact: true }).first().click();
  const modale = page.locator('[role="dialog"]').last();
  await modale.locator('select[name="nouveau_groupe_id"]').selectOption({ index: 1 });
  await modale.getByLabel(/8h – 14h/).check();
  const zone = modale.locator('.form-group', { has: page.locator('input[name="frais_personnalise"]') });
  await zone.getByRole('button', { name: '15 %' }).click();
  const [, , reste] = await resume(zone);
  await expect(zone.locator('input[name="frais_personnalise"]')).toHaveValue(String(reste));
  await modale.getByRole('button', { name: 'Annuler' }).click();
});
