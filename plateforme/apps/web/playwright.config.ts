import { defineConfig, devices } from '@playwright/test';

/**
 * Headed by default so the run can be watched; CI overrides with
 * PWTEST_HEADLESS=1.
 *
 * Assertions get a long timeout because Next compiles each route on its first
 * hit in development. A short timeout here measures the dev server, not the
 * product.
 */
const headless = process.env.CI === 'true' || process.env.PWTEST_HEADLESS === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  /**
   * ⚠ UNE REPRISE, MÊME EN LOCAL, ET LA RAISON EST MESURÉE.
   *
   * Sur une exécution complète, un test échoue de temps à autre — jamais le
   * même — et repasse seul à chaque fois : `payroll › decides a request once`,
   * puis `tenant-isolation › an accountant sees Finance`, puis `payroll ›
   * reports a real month`, puis `payroll › an accountant may raise`. Quatre
   * tests différents, quatre fois le même diagnostic.
   *
   * La cause est le serveur de développement : Next compile chaque route à sa
   * première visite, et sous la charge d'une suite entière cette compilation
   * dépasse parfois le délai de navigation. Une reprise trouve la route déjà
   * compilée.
   *
   * Une reprise qui passe dit « c'était la compilation » ; une reprise qui
   * échoue reste un échec. Zéro reprise en local ne rendait pas la suite plus
   * honnête, seulement plus bruyante — et une suite bruyante finit ignorée.
   */
  retries: 1,
  reporter: [['line']],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://nour.localhost:3000',
    // Même raison : la première visite d'une route la compile.
    navigationTimeout: 45_000,
    headless,
    trace: 'retain-on-failure',
    // Un Chromium déjà installé (poste sans téléchargement) : PLAYWRIGHT_CHROMIUM_PATH.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    /*
     * ⚠ LE MÊME NAVIGATEUR QUE LES TESTS. Sans profil, la connexion se faisait
     * en « HeadlessChrome/… » et les tests tournaient en « Chrome/… » (Desktop
     * Chrome) : au premier renouvellement (13 min), l'API voyait un autre
     * User-Agent, révoquait la famille de jetons (fingerprint_mismatch), et
     * tout test après le quart d'heure lisait « Votre session a expiré ».
     * Invisible tant que la suite durait moins de quinze minutes.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
