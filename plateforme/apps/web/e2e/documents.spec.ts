import { test, expect } from './session';
import type { Page } from '@playwright/test';

/**
 * DOCUMENTS SIGNÉS — demande du propriétaire de Jinan (04/10/2026), ADR-0080.
 * Sur l'école de développement `jinan` (seed:jinan) : la famille « Mohamed
 * Ould Abdallahi » a deux enfants inscrits — Hamoud (cantine petit déjeuner)
 * et Aminetou (cantine déjeuner, piscine).
 *
 *   1. chercher la famille par le nom ou le numéro, l'ouvrir ;
 *   2. chaque enfant : inscription + comportements sociaux + ses services
 *      (pas de photocopie : 0049) ;
 *   3. déposer, voir, remplacer, refuser un Word, supprimer.
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const SECRETARIAT = 'e2e/.auth/jinan-secretaire.json';
const J = 'http://jinan.localhost:3000';

test.describe.configure({ mode: 'serial' });

const PDF = { name: 'piscine-signee.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4000, 66)]) };
const PNG = {
  name: 'piscine-photo.png',
  mimeType: 'image/png',
  buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 3)]),
};
const DOCX = {
  name: 'contrat.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26, 1), Buffer.from('[Content_Types].xml'), Buffer.alloc(64)]),
};

async function ouvrirFamille(page: Page, recherche: string) {
  await page.goto(`${J}/documents`);
  await page.locator('#doc-q').fill(recherche);
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.locator('.doc-resultat', { hasText: 'Mohamed Ould Abdallahi' }).click();
  await expect(page.getByRole('heading', { name: 'Mohamed Ould Abdallahi' })).toBeVisible({ timeout: 30000 });
}

const enfant = (page: Page, prenom: string) => page.locator('.doc-enfant', { hasText: prenom });

test.describe('Documents — la direction', () => {
  test.use({ storageState: DIRECTION });

  test('chercher par le nom : chaque enfant a inscription, comportements sociaux et ses services', async ({ page }) => {
    await ouvrirFamille(page, 'Abdallahi');
    await expect(enfant(page, 'Hamoud').locator('.doc-piece__titre')).toHaveText([
      'Inscription', 'Comportements sociaux', 'Cantine — petit déjeuner',
    ]);
    await expect(enfant(page, 'Aminetou').locator('.doc-piece__titre')).toHaveText([
      'Inscription', 'Comportements sociaux', 'Cantine — déjeuner', 'Piscine',
    ]);
  });

  test('déposer, voir, remplacer, refuser un Word, supprimer', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await ouvrirFamille(page, 'Abdallahi');
    const piscine = enfant(page, 'Aminetou').getByTestId('piece-piscine');

    // Un reste d'une exécution interrompue : la pièce repart vide.
    if (await piscine.getByRole('button', { name: 'Supprimer' }).count()) {
      await piscine.getByRole('button', { name: 'Supprimer' }).click();
      await expect(piscine).toContainText('En attente du document signé', { timeout: 30000 });
    }
    await expect(piscine).toContainText('En attente du document signé');

    // Un Word n'est pas un document signé.
    await piscine.locator('input[type=file]').setInputFiles(DOCX);
    await piscine.getByRole('button', { name: 'Déposer' }).click();
    await expect(page.getByText(/contrat\.docx : Type de fichier non autorisé\. Acceptés : JPG, PNG, WebP, GIF, PDF\./)).toBeVisible({ timeout: 30000 });

    // Déposer le PDF.
    await piscine.locator('input[type=file]').setInputFiles(PDF);
    await piscine.getByRole('button', { name: 'Déposer' }).click();
    await expect(page.getByText('Piscine — Aminetou : document déposé. La famille le voit dans l’application.')).toBeVisible({ timeout: 30000 });
    await expect(piscine).toContainText('Document signé');
    await expect(piscine).toContainText('piscine-signee.pdf');

    // Voir : le fichier, relayé par le site.
    const href = await piscine.getByRole('link', { name: 'Voir' }).getAttribute('href');
    // Depuis le navigateur : seul Chromium résout *.localhost, pas Node.
    const r = await page.evaluate(async (u) => {
      const x = await fetch(u);
      return { status: x.status, type: x.headers.get('content-type'), nosniff: x.headers.get('x-content-type-options') };
    }, href!);
    expect(r).toEqual({ status: 200, type: 'application/pdf', nosniff: 'nosniff' });

    // Remplacer par une photo.
    await piscine.getByRole('button', { name: 'Remplacer' }).click();
    await piscine.locator('input[type=file]').setInputFiles(PNG);
    await piscine.getByRole('button', { name: 'Enregistrer le remplacement' }).click();
    await expect(page.getByText('Piscine — Aminetou : document remplacé. La famille le voit dans l’application.')).toBeVisible({ timeout: 30000 });
    await expect(piscine).toContainText('piscine-photo.png');

    // Supprimer : la pièce attend de nouveau son document.
    await piscine.getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByText('Piscine — Aminetou : document supprimé.')).toBeVisible({ timeout: 30000 });
    await expect(piscine).toContainText('En attente du document signé');
  });

  /**
   * ⚠ LES DÉPÔTS NE FONT PLUS LA QUEUE (04/10/2026). En actions serveur, Next
   * les passait un par un : le second restait « Envoi… » derrière le premier,
   * et se perdait si l'on rechargeait la page. Deux dépôts lancés ensemble
   * arrivent tous les deux, et on peut recharger dès qu'ils sont faits.
   */
  test('deux dépôts lancés ensemble arrivent tous les deux', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await ouvrirFamille(page, 'Abdallahi');
    const aminetou = enfant(page, 'Aminetou');
    const pieces = [aminetou.getByTestId('piece-comportement_social'), aminetou.getByTestId('piece-piscine')];
    for (const p of pieces) {
      if (await p.getByRole('button', { name: 'Supprimer' }).count()) {
        await p.getByRole('button', { name: 'Supprimer' }).click();
        await expect(p).toContainText('En attente du document signé', { timeout: 30000 });
      }
    }
    await pieces[0]!.locator('input[type=file]').setInputFiles({ ...PDF, name: 'comportement-signe.pdf' });
    await pieces[1]!.locator('input[type=file]').setInputFiles({ ...PDF, name: 'piscine-ensemble.pdf' });
    // Le second clic part pendant que le premier envoi est encore en vol.
    await pieces[0]!.getByRole('button', { name: 'Déposer' }).click();
    await pieces[1]!.getByRole('button', { name: 'Déposer' }).click();
    await expect(pieces[0]!).toContainText('comportement-signe.pdf', { timeout: 30000 });
    await expect(pieces[1]!).toContainText('piscine-ensemble.pdf', { timeout: 30000 });
    await page.reload();
    await expect(enfant(page, 'Aminetou').getByTestId('piece-comportement_social')).toContainText('comportement-signe.pdf');
    await expect(enfant(page, 'Aminetou').getByTestId('piece-piscine')).toContainText('piscine-ensemble.pdf');
    // Et on remet les pièces à vide pour la prochaine exécution.
    for (const id of ['piece-comportement_social', 'piece-piscine']) {
      const p = enfant(page, 'Aminetou').getByTestId(id);
      await p.getByRole('button', { name: 'Supprimer' }).click();
      await expect(p).toContainText('En attente du document signé', { timeout: 30000 });
    }
  });

  test('chercher par le numéro de téléphone', async ({ page }) => {
    await page.goto(`${J}/documents`);
    // Le numéro de la famille, lu sur le résultat de la recherche par nom.
    await page.locator('#doc-q').fill('Abdallahi');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    const texte = await page.locator('.doc-resultat', { hasText: 'Mohamed Ould Abdallahi' }).innerText();
    const numero = texte.match(/\d{8}/)?.[0];
    expect(numero).toBeTruthy();
    await ouvrirFamille(page, numero!.slice(0, 6));
  });
});

test.describe('Documents — le secrétariat', () => {
  test.use({ storageState: SECRETARIAT });

  test('le secrétariat a l’entrée « Documents » et la page', async ({ page }) => {
    await page.goto(`${J}/re-enrol`);
    await expect(page.locator('nav a[href="/documents"]')).toBeVisible();
    await ouvrirFamille(page, 'Abdallahi');
  });
});
