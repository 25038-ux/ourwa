import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * ⚠ LE JETON DE RAFRAÎCHISSEMENT TOURNE, ET CHAQUE TEST OUVRE UN NOUVEAU
 * CONTEXTE DEPUIS LE MÊME FICHIER `.auth/*.json`.
 *
 * Au bout de quinze minutes le jeton d'accès arrive à échéance ; le premier
 * test à le présenter obtient une rotation (T0 → T1) — dans SON contexte
 * seulement. Le test suivant repart du fichier, présente T0, et l'API y voit
 * une réutilisation : toute la famille est révoquée, et chaque test qui suit
 * lit « Votre session a expiré ». Une suite de quarante-quatre tests tenait
 * sous le quart d'heure ; celle-ci ne tient plus.
 *
 * La réutilisation d'un jeton DOIT révoquer (règle 13) — c'est le suite qui
 * avait tort de partager un jeton entre contextes, ce qu'aucun navigateur ne
 * fait. Après chaque test, l'état du contexte est réécrit dans le fichier dont
 * il vient : le test suivant repart du jeton courant.
 */
export const test = base.extend<{ persisterLaSession: void }>({
  persisterLaSession: [
    async ({ page, storageState }, use) => {
      await use();
      if (typeof storageState === 'string') {
        await page.context().storageState({ path: storageState }).catch(() => undefined);
      }
    },
    { auto: true },
  ],
});
