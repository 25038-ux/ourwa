import { test, expect } from './session';

/**
 * LE NNI ET LE RIM FACULTATIFS À L'INSCRIPTION — décision du propriétaire du
 * 30/09/2026 (migration 0044). Deux enfants de suite, sans l'un ni l'autre :
 * les deux s'inscrivent (aucun « Un étudiant avec ce RIM ou ce NNI existe
 * déjà »), et la page ne les exige plus.
 */
const DIRECTOR = 'e2e/.auth/nour-admin.json';
const TAG = String(Date.now()).slice(-6);

test.describe('inscrire sans NNI ni RIM', () => {
  test.use({ storageState: DIRECTOR });

  test('deux enfants sans papiers, l’un après l’autre', async ({ page }) => {
    for (const n of [1, 2]) {
      await page.goto('http://nour.localhost:3000/students/new');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('input[name="rim"]')).not.toHaveAttribute('required', /.*/);
      await expect(page.locator('input[name="nni"]')).not.toHaveAttribute('required', /.*/);
      await expect(page.getByText('RIM (facultatif, unique)')).toBeVisible();
      await page.locator('input[name="prenom"]').fill(`Sanspapiers${n}`);
      await page.locator('input[name="nom"]').fill(`Essai ${TAG}`);
      const groupe = await page.locator('select[name="groupe_id"] option:not([value=""])').first().getAttribute('value');
      await page.locator('select[name="groupe_id"]').selectOption(groupe!);
      await page.getByRole('radio', { name: 'Nouveau parent' }).check();
      await page.locator('input[name="p_nom"]').fill(`Parent Sanspapiers ${TAG} ${n}`);
      await page.locator('input[name="p_tel"]').fill(`4${TAG}${n}`);
      await expect(page.locator('input[name="p_mdp"]')).toHaveValue(/.{8}/, { timeout: 30000 });
      await page.getByRole('button', { name: /Inscrire l.étudiant/ }).click();
      await expect(page.getByText(/Étudiant inscrit avec succès ! Matricule/)).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(/existe déjà|obligatoire/)).toHaveCount(0);
    }
  });
});
