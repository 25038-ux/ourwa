import { test as base } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

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
 *
 * ⚠ LE JETON, PAS L'ANNÉE CHOISIE (16/10/2026). Depuis que le middleware
 * mémorise l'année du sélecteur dans un cookie de session (`…_annee`), réécrire
 * TOUT l'état la passait au test suivant : un test qui choisit une année
 * clôturée laissait chaque test suivant du même compte s'ouvrir sur elle
 * (« se souvient de l'année… » échouait, l'année « ouverte » étant déjà la
 * clôturée). Dans un navigateur, cette mémoire finit avec la session ; ici,
 * chaque test est une nouvelle session qui garde seulement le jeton.
 */
export const test = base.extend<{ persisterLaSession: void }>({
  persisterLaSession: [
    async ({ page, storageState }, use) => {
      await use();
      if (typeof storageState === 'string') {
        const etat = await page.context().storageState().catch(() => null);
        if (!etat) return;
        etat.cookies = etat.cookies.filter((c) => !c.name.endsWith('_annee'));
        await writeFile(storageState, JSON.stringify(etat, null, 2)).catch(() => undefined);
      }
    },
    { auto: true },
  ],
});
