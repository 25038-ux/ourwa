import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * LES NIVEAUX CLASSÉS PAR CYCLE — demande du propriétaire de Jinan
 * (30/09/2026) : Maternelle, Fondamentales, Collège, Lycée, dans cet ordre,
 * une « barrière » entre chaque. Sur l'école de développement `jinan` (ses
 * niveaux 1 AF – 4 AF sont « Fondamentales ») : un niveau de maternelle créé
 * avec son cycle, son intertitre AVANT celui des fondamentales, sa classe
 * sous la rubrique « Maternelle » de la liste d'inscription, puis reclassé en
 * lycée (intertitre APRÈS) — et tout ce que le test a créé est supprimé.
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const J = 'http://jinan.localhost:3000';
const TAG = String(Date.now()).slice(-5);
const NIVEAU = `TPS${TAG}`;

async function prete(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/** Les intertitres de cycle, dans l'ordre de la page. */
async function cyclesAffiches(page: Page) {
  return page.locator('tr.cycle-sep').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-testid')));
}

test.describe('les niveaux par cycle', () => {
  test.use({ storageState: DIRECTION });

  test('créer, voir la barrière, choisir la classe dans sa rubrique, reclasser', async ({ page }) => {
    test.setTimeout(180_000);
    page.on('dialog', (d) => d.accept());

    // 1. Créer un niveau de maternelle, rang 1.
    await prete(page, `${J}/scolarite/niveaux`);
    await page.locator('#nom_niveau').fill(NIVEAU);
    await page.locator('#cycle_niveau').selectOption('maternelle');
    await page.locator('#rang_niveau').fill('1');
    await page.getByRole('button', { name: 'Créer le Niveau' }).click();
    await expect(page.getByText(`Niveau « ${NIVEAU} » créé avec succès !`)).toBeVisible({ timeout: 30000 });

    // 2. La barrière « Maternelle » vient AVANT « Fondamentales », et le niveau dessous.
    await prete(page, `${J}/scolarite/niveaux`);
    expect(await cyclesAffiches(page)).toEqual(['cycle-maternelle', 'cycle-fondamental']);
    await expect(page.getByTestId('cycle-maternelle')).toContainText('Maternelle');
    const apres = page.locator('tr.cycle-sep[data-testid="cycle-maternelle"] + tr');
    await expect(apres).toContainText(NIVEAU);

    // 3. Une classe dans ce niveau → la liste d'inscription la range sous « Maternelle ».
    await page.locator('tr', { hasText: NIVEAU }).getByRole('link', { name: 'Ouvrir' }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('#nom_groupe').fill(`${NIVEAU} A`);
    await page.getByRole('button', { name: 'Créer le groupe' }).click();
    await expect(page.getByText(new RegExp(`Groupe « ${NIVEAU} A » créé`))).toBeVisible({ timeout: 30000 });
    await prete(page, `${J}/students/new`);
    const rubrique = page.locator('select[name="groupe_id"] optgroup[label="── Maternelle ──"]');
    await expect(rubrique.locator('option', { hasText: `${NIVEAU} — ${NIVEAU} A` })).toHaveCount(1);
    const labels = await page.locator('select[name="groupe_id"] optgroup').evaluateAll((gs) => gs.map((g) => g.getAttribute('label')));
    expect(labels).toEqual(['── Maternelle ──', '── Fondamentales ──']);
    // Et la page des groupes a les mêmes intertitres.
    await prete(page, `${J}/scolarite/groupes`);
    await expect(page.getByTestId('cycle-maternelle')).toBeVisible();
    await expect(page.getByTestId('cycle-fondamental')).toBeVisible();

    // 4. Reclasser en Lycée : son intertitre passe APRÈS les fondamentales.
    await prete(page, `${J}/scolarite/niveaux`);
    const ligne = page.locator('tr', { hasText: NIVEAU }).first();
    await ligne.getByLabel(`Cycle de ${NIVEAU}`).selectOption('lycee');
    await ligne.getByRole('button', { name: `Classer ${NIVEAU}` }).click();
    await expect(page.getByText(`Niveau « ${NIVEAU} » classé.`)).toBeVisible({ timeout: 30000 });
    await prete(page, `${J}/scolarite/niveaux`);
    expect(await cyclesAffiches(page)).toEqual(['cycle-fondamental', 'cycle-lycee']);

    // 5. Ranger : la classe, puis le niveau.
    await page.locator('tr', { hasText: NIVEAU }).getByRole('link', { name: 'Ouvrir' }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('tr', { hasText: `${NIVEAU} A` }).getByRole('button', { name: /Supprimer/ }).click();
    await expect(page.getByText(/supprimé/i).first()).toBeVisible({ timeout: 30000 });
    await prete(page, `${J}/scolarite/niveaux`);
    await page.locator('tr', { hasText: NIVEAU }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.locator('tr', { hasText: NIVEAU })).toHaveCount(0, { timeout: 30000 });
  });
});
