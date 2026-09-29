import { test, expect } from './session';

/**
 * LES ABSENCES DU PERSONNEL (ADR-0074) — dans le navigateur, à Jinan
 * (`seed:jinan` : six professeurs et leur grille, quatre agents et leurs
 * horaires).
 *
 * Le collecteur d'absence déclare (une séance d'un professeur, une partie de
 * la période d'un agent) ; la direction justifie, lit la synthèse du mois,
 * retire. Tout se passe sur un lundi passé, et le test finit par retirer ce
 * qu'il a déclaré : il se relance sans rien laisser.
 */
const COLLECTEUR = 'e2e/.auth/jinan-absence.json';
const DIRECTION = 'e2e/.auth/jinan-admin.json';

/** Le lundi d'il y a deux semaines (AAAA-MM-JJ) : passé, dans l'année ouverte. */
function lundiPasse(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 14);
  const jour = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (jour - 1));
  return d.toISOString().slice(0, 10);
}

const DATE = lundiPasse();
const URL_JOUR = `http://jinan.localhost:3000/personnel/absences?date=${DATE}`;

/** Ouvre la journée et attend que la page soit interactive (cases contrôlées par React). */
async function ouvrir(page: import('@playwright/test').Page) {
  await page.goto(URL_JOUR);
  await page.waitForLoadState('networkidle');
}

/** Retire tout ce qui est déclaré ce jour-là (ce que ce rôle a le droit de retirer). */
async function nettoyer(page: import('@playwright/test').Page) {
  page.on('dialog', (d) => d.accept());
  await ouvrir(page);
  for (let i = 0; i < 20 && (await page.getByRole('button', { name: "Retirer l'absence" }).count()) > 0; i++) {
    await page.getByRole('button', { name: "Retirer l'absence" }).first().click();
    await expect(page.getByText('Absence retirée.')).toBeVisible({ timeout: 30000 });
    await ouvrir(page);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('le collecteur d’absence déclare', () => {
  test.use({ storageState: COLLECTEUR });

  test('une séance d’un professeur, une partie de la période d’un agent', async ({ page }) => {
    await nettoyer(page);
    await expect(page.getByRole('heading', { name: 'Absences du personnel' })).toBeVisible();
    // Le menu du collecteur mène ici.
    await expect(page.locator('.sidebar-nav a[href="/personnel/absences"]')).toBeVisible();

    // Le premier professeur du jour : sa première séance.
    const prof = page.locator('[data-testid^="prof-"]').first();
    await expect(prof).toBeVisible({ timeout: 30000 });
    const testid = await prof.getAttribute('data-testid');
    await prof.locator('input[type="checkbox"]').first().check();
    await prof.getByPlaceholder('Motif (facultatif)').fill('Malade (E2E)');
    await prof.getByRole('button', { name: 'Déclarer absent (1)' }).click();
    await expect(page.getByText('1 séance manquée déclarée.')).toBeVisible({ timeout: 30000 });
    await expect(page.locator(`[data-testid="${testid}"]`).getByText('1 séance manquée')).toBeVisible();
    // Le collecteur ne justifie pas : c'est la direction.
    await expect(page.getByRole('button', { name: 'Justifier' })).toHaveCount(0);

    // La surveillante : arrivée à 9 h au lieu de 7 h 30.
    const agent = page.locator('[data-testid^="agent-"]', { hasText: 'Surveillante' });
    await agent.getByRole('button', { name: 'En partie…' }).click();
    await agent.getByLabel('Absent de').fill('07:30');
    await agent.getByLabel("Absent jusqu'à").fill('09:00');
    await agent.getByRole('button', { name: 'Déclarer' }).click();
    await expect(page.getByText('1 période manquée déclarée.')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid^="agent-"]', { hasText: 'Surveillante' }).getByText('07:30 – 09:00')).toBeVisible();
  });

  test('hors de ses horaires, l’API refuse en le disant', async ({ page }) => {
    await ouvrir(page);
    const agent = page.locator('[data-testid^="agent-"]', { hasText: 'Chauffeur' });
    await agent.getByRole('button', { name: 'En partie…' }).click();
    await agent.getByLabel('Absent de').fill('09:00');
    await agent.getByLabel("Absent jusqu'à").fill('10:00');
    // Les bornes du champ l'empêchent déjà ; on les retire pour voir l'API refuser.
    await agent.getByLabel('Absent de').evaluate((el) => el.removeAttribute('max'));
    await agent.getByLabel("Absent jusqu'à").evaluate((el) => el.removeAttribute('max'));
    await agent.getByRole('button', { name: 'Déclarer' }).click();
    await expect(page.getByText(/sort de la période de travail 07:00 – 09:00/)).toBeVisible({ timeout: 30000 });
  });
});

test.describe('la direction', () => {
  test.use({ storageState: DIRECTION });

  test('justifie, lit la synthèse du mois, puis retire', async ({ page }) => {
    await ouvrir(page);
    const prof = page.locator('[data-testid^="prof-"]').first();
    await prof.getByLabel('Motif de la justification').fill('Certificat médical');
    await prof.getByRole('button', { name: 'Justifier' }).click();
    await expect(page.getByText('Absence justifiée.', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid^="prof-"]').first().locator('.badge', { hasText: 'Absence justifiée' })).toBeVisible();

    const [annee, mois] = DATE.split('-').map(Number);
    await page.goto(`http://jinan.localhost:3000/personnel/absences?vue=mois&mois=${mois}&annee=${annee}`);
    const lignes = page.locator('table tbody tr');
    await expect(lignes.filter({ hasText: 'Surveillante' })).toContainText('1 h 30');
    await expect(lignes.filter({ hasText: 'Professeur' }).first()).toContainText('1 séance');
    await expect(page.getByText(/aucune retenue n.est calculée automatiquement/)).toBeVisible();

    // Retirer ce que le test a déclaré (une justifiée : la direction seule le peut).
    await nettoyer(page);
    await expect(page.getByRole('button', { name: "Retirer l'absence" })).toHaveCount(0);
  });

  test('fixe les horaires d’un agent', async ({ page }) => {
    await page.goto('http://jinan.localhost:3000/personnel/absences?vue=horaires');
    const carte = page.locator('[data-testid^="horaires-"]', { hasText: 'Chauffeur' });
    await expect(carte.getByText('5 périodes')).toBeVisible();
    await carte.getByRole('button', { name: '+ Période' }).click();
    // La période ajoutée reprend les heures de la dernière, au jour suivant (samedi).
    await carte.getByRole('button', { name: 'Enregistrer les horaires' }).click();
    await expect(page.getByText('Horaires enregistrés (6 périodes).')).toBeVisible({ timeout: 30000 });
    // … et on revient à cinq jours.
    await page.reload();
    const c2 = page.locator('[data-testid^="horaires-"]', { hasText: 'Chauffeur' });
    await c2.getByRole('button', { name: 'Retirer cette période' }).last().click();
    await c2.getByRole('button', { name: 'Enregistrer les horaires' }).click();
    await expect(page.getByText('Horaires enregistrés (5 périodes).')).toBeVisible({ timeout: 30000 });
  });
});
