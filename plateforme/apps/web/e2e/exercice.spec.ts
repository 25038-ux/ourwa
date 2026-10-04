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

  /**
   * Jinan, 04/10/2026 : « fix envoyer exercice because you can't send any
   * document there ». Deux causes : le sélecteur n'admettait que images et PDF
   * (une fiche Word était grisée, et refusée par le serveur), et le middleware
   * de Next coupait toute requête à 10 Mo — trois photos de 4 Mo faisaient
   * tomber la page.
   */
  test('une fiche Word et trois fichiers de 4 Mo partent ensemble', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/homework');
    await page.locator('#ex-classe').selectOption({ index: 1 });
    await page.locator('select[name="enseignement_id"]').selectOption({ index: 1 });
    await page.fill('input[name="titre"]', 'Exercice e2e — fiche Word');
    await page.fill('textarea[name="description"]', 'La fiche jointe, et les trois pages scannées.');
    // Une vraie archive OOXML minimale : l'en-tête ZIP et `[Content_Types].xml`.
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(26, 1),
      Buffer.from('[Content_Types].xml'),
      Buffer.alloc(256, 2),
    ]);
    const page4Mo = (n: number) => ({
      name: `page-${n}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4 * 1024 * 1024, 120)]),
    });
    await page.setInputFiles('input[name="fichiers"]', [
      { name: 'Fiche de révision.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx },
      page4Mo(1), page4Mo(2), page4Mo(3),
    ]);
    // Le sélecteur propose les documents de bureau.
    await expect(page.locator('input[name="fichiers"]')).toHaveAttribute('accept', /\.docx/);
    await page.getByRole('button', { name: "Envoyer l'exercice" }).click();
    await expect(page.getByText(/Exercice envoyé\. \d+ parent\(s\) notifié\(s\) avec 4 fichier\(s\) joint\(s\)/)).toBeVisible({ timeout: 60000 });
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
