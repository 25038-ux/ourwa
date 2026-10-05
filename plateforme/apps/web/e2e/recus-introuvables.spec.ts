import { test, expect } from './session';

/**
 * « REÇU INTROUVABLE » SEULEMENT QUAND IL L'EST (05/10/2026).
 *
 * Les pages de reçu disaient « Reçu introuvable » pour TOUT échec — une API
 * lente ou en redémarrage comprise : la caissière croyait le paiement perdu.
 * Elles le disent encore pour un reçu qui n'existe pas (404) ou un lien mal
 * formé (400) ; un échec passager va à la page d'erreur, qui dit « le serveur
 * ne répond pas » et réessaie (vérifié à la main en arrêtant l'API : la page
 * reste sur place et revient seule quand l'API répond).
 */
const DIRECTION = 'e2e/.auth/jinan-admin.json';
const J = 'http://jinan.localhost:3000';
const ABSENT = '00000000-0000-4000-8000-000000000000';

test.use({ storageState: DIRECTION });

for (const chemin of [
  `/finance/recu/${ABSENT}`,
  `/finance/recu/annuel/${ABSENT}`,
  `/finance/recu/groupe/${ABSENT}`,
  '/finance/recu/pas-un-identifiant',
]) {
  test(`${chemin} : « Reçu introuvable. », pas une page d’erreur`, async ({ page }) => {
    await page.goto(`${J}${chemin}`);
    await expect(page.getByText('Reçu introuvable.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Cette page n’a pas pu s’afficher')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
  });
}
