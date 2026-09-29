import { test, expect } from './session';

/**
 * « Envoyer un exercice » — signalé « still broken » par le propriétaire
 * (20/09). Le formulaire, sans fichier, doit envoyer et dire combien de
 * parents ont été prévenus ; avec un champ vide, il doit refuser en le disant.
 */
const DIRECTOR = 'e2e/.auth/nour-admin.json';
const PROF = 'e2e/.auth/nour-prof.json';

test.describe('envoyer un exercice', () => {
  test.use({ storageState: DIRECTOR });

  test('la direction envoie un exercice à une classe et les parents sont prévenus', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/homework');
    // La classe d'abord, la matière ensuite.
    await page.locator('#ex-classe').selectOption({ index: 1 });
    const matiere = page.locator('select[name="enseignement_id"]');
    await expect(matiere).toBeEnabled();
    await matiere.selectOption({ index: 1 });
    await page.fill('input[name="titre"]', 'Exercice e2e — lecture');
    await page.fill('textarea[name="description"]', 'Lire le chapitre 3 et répondre aux questions.');
    await page.getByRole('button', { name: "Envoyer l'exercice" }).click();
    await expect(page.getByText(/Exercice envoyé\. \d+ parent\(s\) notifié\(s\)/)).toBeVisible({ timeout: 30000 });
  });

  test('un titre vide est refusé, en le disant', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/homework');
    await page.locator('#ex-classe').selectOption({ index: 1 });
    await page.locator('select[name="enseignement_id"]').selectOption({ index: 1 });
    await page.fill('textarea[name="description"]', 'Sans titre.');
    // `required` côté navigateur retiré côté serveur : on force l'envoi.
    await page.evaluate(() => document.querySelectorAll('[required]').forEach((e) => e.removeAttribute('required')));
    await page.getByRole('button', { name: "Envoyer l'exercice" }).click();
    await expect(page.getByText('Titre et description obligatoires.')).toBeVisible({ timeout: 30000 });
  });
});

test.describe('le professeur envoie à SA classe', () => {
  test.use({ storageState: PROF });

  test('la page du professeur envoie aussi', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/prof/exercice');
    const classe = page.locator('select[name="enseignement_id"]');
    await expect(classe).toBeVisible();
    await classe.selectOption({ index: 1 });
    await page.fill('input[name="titre"]', 'Exercice e2e — prof');
    await page.fill('textarea[name="description"]', 'Exercices 1 à 4.');
    await page.getByRole('button', { name: "Envoyer l'exercice" }).click();
    await expect(page.getByText(/Exercice envoyé\. \d+ parent\(s\) notifié\(s\)/)).toBeVisible({ timeout: 30000 });
  });
});
