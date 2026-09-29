import { validatePassword } from '@elourwa/shared/password';
import { test, expect } from './session';

/**
 * Le mot de passe d'un compte parent arrive GÉNÉRÉ (28/09, demande d'El
 * Mourad) : à l'admission (« Mot de passe initial ») et dans « Reset mdp ».
 * Visible, conforme à la politique (8 caractères, 3 types), et ↻ en tire un
 * autre. Rien n'est envoyé : aucun compte n'est modifié par ce test.
 */
const DIRECTOR = 'e2e/.auth/nour-admin.json';

test.describe('le mot de passe généré des comptes parents', () => {
  test.use({ storageState: DIRECTOR });

  test('admission : le champ « Mot de passe initial » est rempli et conforme', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/students/new');
    // Le champ n'existe que pour un NOUVEAU parent (un parent existant garde le sien).
    await page.getByRole('radio', { name: 'Nouveau parent' }).check();
    const champ = page.locator('input[name="p_mdp"]');
    await expect(champ).toHaveValue(/.{10}/, { timeout: 30000 });
    const premier = await champ.inputValue();
    expect(validatePassword(premier)).toBe('');

    await page.getByRole('button', { name: 'Générer un autre mot de passe' }).first().click();
    await expect(champ).not.toHaveValue(premier);
    expect(validatePassword(await champ.inputValue())).toBe('');
  });

  test('« Reset mdp » : la fenêtre s’ouvre avec un mot de passe conforme', async ({ page }) => {
    await page.goto('http://nour.localhost:3000/comptes/parents');
    await page.getByRole('button', { name: 'Reset mdp' }).first().click();
    const champ = page.locator('.modal input[name="nouveau_mdp"], [role="dialog"] input[name="nouveau_mdp"]').first();
    await expect(champ).toBeVisible({ timeout: 30000 });
    await expect(champ).toHaveValue(/.{10}/);
    expect(validatePassword(await champ.inputValue())).toBe('');
  });
});
