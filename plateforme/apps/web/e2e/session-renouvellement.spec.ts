import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';

/**
 * « DÉCONNECTÉ APRÈS UN QUART D'HEURE SANS RIEN FAIRE » (05/10/2026).
 *
 * Le jeton d'accès vit quinze minutes. Après une pause, le premier geste
 * envoie plusieurs requêtes à la fois, toutes avec le même cookie de
 * renouvellement : chacune le présentait à l'API, la deuxième y était une
 * RÉUTILISATION, et toute la famille de jetons était révoquée — la personne
 * revenait à la connexion, les reçus et les pages « ne chargeaient pas ».
 *
 * Le site ne présente plus qu'une fois un jeton donné, pour un navigateur
 * donné ; l'API, elle, révoque toujours un jeton réutilisé (règle 13) — le
 * dernier test le prouve depuis « un autre appareil ».
 *
 * Les requêtes partent de Node avec `X-Forwarded-Host` (Node ne résout pas
 * `*.localhost`), le cookie de renouvellement SEUL (= jeton d'accès expiré),
 * et le User-Agent du navigateur qui s'est connecté.
 */
const J = 'http://jinan.localhost:3000';
const SITE = 'http://localhost:3000';

async function connexion(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${J}/login`);
  await page.getByLabel('Identifiant').fill('admin@jinan.test');
  await page.getByLabel('Mot de passe', { exact: true }).fill('dev12345');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  const ua = await page.evaluate(() => navigator.userAgent);
  const refresh = (await ctx.cookies()).find((c) => c.name.endsWith('_refresh'))!;
  await ctx.close();
  return { ua, nom: refresh.name, jeton: refresh.value };
}

function aller(chemin: string, nom: string, jeton: string, ua: string) {
  return fetch(`${SITE}${chemin}`, {
    headers: { 'x-forwarded-host': 'jinan.localhost:3000', cookie: `${nom}=${jeton}`, 'user-agent': ua },
    redirect: 'manual',
  });
}

/** Le jeton de renouvellement posé par la réponse : une valeur, '' (effacé), ou null (rien). */
function jetonPose(r: Response, nom: string): string | null {
  const c = r.headers.getSetCookie().find((x) => x.startsWith(`${nom}=`));
  return c === undefined ? null : (c.split(';')[0]!.slice(nom.length + 1));
}

test.describe('le renouvellement de session', () => {
  test.describe.configure({ mode: 'serial' });

  test('six requêtes simultanées après la pause : un seul renouvellement, la session tient', async ({ browser }) => {
    const { ua, nom, jeton } = await connexion(browser);
    const chemins = ['/', '/finance', '/documents', '/re-enrol', '/messages', '/frais'];
    const reponses = await Promise.all(chemins.map((p) => aller(p, nom, jeton, ua)));

    const poses = reponses.map((r) => jetonPose(r, nom));
    for (const [i, r] of reponses.entries()) {
      expect(r.headers.get('location') ?? '', chemins[i]).not.toContain('/login');
      expect(poses[i], chemins[i]).toBeTruthy();
    }
    // Toutes reçoivent LE MÊME nouveau jeton.
    expect(new Set(poses).size).toBe(1);
    expect(poses[0]).not.toBe(jeton);

    // Et il fonctionne : la session n'a pas été révoquée.
    const apres = await aller('/', nom, poses[0]!, ua);
    expect(apres.status).toBe(200);
  });

  test('une requête partie avec l’ancien jeton un instant après reçoit le même nouveau jeton', async ({ browser }) => {
    const { ua, nom, jeton } = await connexion(browser);
    const premiere = await aller('/', nom, jeton, ua);
    const nouveau = jetonPose(premiere, nom);
    expect(nouveau).toBeTruthy();

    await new Promise((r) => setTimeout(r, 1500));
    const retardataire = await aller('/finance', nom, jeton, ua);
    expect(retardataire.headers.get('location') ?? '').not.toContain('/login');
    expect(jetonPose(retardataire, nom)).toBe(nouveau);

    expect((await aller('/', nom, nouveau!, ua)).status).toBe(200);
  });

  test('⚠ le même jeton présenté depuis un autre appareil : l’API révoque toujours tout', async ({ browser }) => {
    const { ua, nom, jeton } = await connexion(browser);
    const nouveau = jetonPose(await aller('/', nom, jeton, ua), nom);
    expect(nouveau).toBeTruthy();

    // « Un autre appareil » : un autre User-Agent, avec le jeton déjà échangé.
    const voleur = await aller('/', nom, jeton, 'Mozilla/5.0 (X11; Linux x86_64) AutreAppareil/1.0');
    expect(voleur.headers.get('location') ?? '').toContain('/login');
    expect(jetonPose(voleur, nom)).toBe('');

    // Et la session du titulaire est fermée avec : c'est la règle 13.
    const titulaire = await aller('/', nom, nouveau!, ua);
    expect(titulaire.headers.get('location') ?? '').toContain('/login');
  });
});
