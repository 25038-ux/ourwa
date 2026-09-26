/*
 * Parcours complet de l'application dans un vrai navigateur (Playwright).
 * À lancer sur une base de TEST : le script crée, modifie et supprime des données.
 *
 *   npm install playwright
 *   PATRIMO_URL=http://localhost/patrimo/ node tests/parcours.test.js
 */
const { chromium } = require('playwright');
const B = process.env.PATRIMO_URL || 'http://127.0.0.1:8080/';
const suffixe = Date.now().toString().slice(-5); // pour pouvoir relancer le script
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  async function session(user) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => ok(false, 'JS error ' + e));
    p.on('dialog', d => d.accept());
    await p.goto(B + 'connexion.php');
    await p.fill('[name=identifiant]', user); await p.fill('[name=mot_de_passe]', 'patrimo2026');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    return p;
  }
  const txt = async p => (await p.textContent('body'));

  // mauvais mot de passe
  { const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.goto(B + 'connexion.php'); await p.fill('[name=identifiant]', 'admin'); await p.fill('[name=mot_de_passe]', 'faux');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    ok((await txt(p)).includes('incorrect'), 'refus mauvais mot de passe'); }

  const a = await session('admin');
  // validation JS : formulaire vide
  await a.goto(B + 'materiel_form.php');
  await a.click('button[type=submit]');
  ok(await a.locator('.champ__erreur').count() >= 2 && a.url().includes('materiel_form'), 'validation JS bloque le formulaire vide');
  // suggestion numéro
  await a.selectOption('[name=categorie_id]', { label: 'Informatique' });
  const num = await a.inputValue('[name=numero_inventaire]');
  ok(/^INF-2026-\d{4}$/.test(num), 'numéro proposé ' + num);
  await a.fill('[name=designation]', 'Ordinateur portable');
  await a.fill('[name=marque]', 'Dell'); await a.fill('[name=modele]', 'Latitude 3540');
  await a.selectOption('[name=direction_id]', { label: 'DSI · Direction des Systèmes d\'Information' });
  await Promise.all([a.waitForNavigation(), a.click('button[type=submit]')]);
  ok(a.url().includes('materiel.php?id='), 'création matériel → fiche');
  const id = new URL(a.url()).searchParams.get('id');
  ok((await txt(a)).includes('Entrée en inventaire'), 'mouvement entrée journalisé');
  ok(await a.locator('.codebarre svg rect').count() > 50, 'code-barres dessiné');
  // doublon de numéro
  await a.goto(B + 'materiel_form.php');
  await a.selectOption('[name=categorie_id]', { label: 'Informatique' });
  await a.fill('[name=numero_inventaire]', num); await a.fill('[name=designation]', 'Test doublon');
  await Promise.all([a.waitForNavigation(), a.click('button[type=submit]')]);
  ok((await txt(a)).includes('déjà attribué'), 'doublon de numéro refusé');

  // changement d'état
  await a.goto(B + 'materiel.php?id=' + id);
  await a.check('input[name=etat][value=en_panne]', { force: true });
  await a.fill('textarea[name=observation]', 'Écran noir au démarrage');
  await Promise.all([a.waitForNavigation(), a.click('form:has([value=etat]) button[type=submit]')]);
  ok((await txt(a)).includes('État mis à jour') && (await txt(a)).includes('Écran noir'), 'changement d\'état + historique');

  // responsable DSI demande un transfert vers DAF
  const k = await session('k.brahim');
  await k.goto(B + 'materiel.php?id=' + id);
  await k.selectOption('form:has([value=transfert]) select', { label: 'DAF · Direction des Affaires Financières' });
  await k.fill('[name=motif]', 'Test de transfert');
  await Promise.all([k.waitForNavigation(), k.click('form:has([value=transfert]) button[type=submit]')]);
  ok((await txt(k)).includes('Transfert en cours'), 'demande de transfert créée');
  // k.brahim ne peut pas gérer les matériels d'une autre direction
  await k.goto(B + 'directions.php');
  ok(k.url().endsWith('index.php'), 'responsable redirigé hors du référentiel');

  // responsable DAF valide l'arrivée
  const c = await session('c.beibakar');
  await c.goto(B + 'transferts.php');
  const art = c.locator('article', { hasText: num });
  await Promise.all([c.waitForNavigation(), art.locator('button', { hasText: "Valider l'arrivée" }).click()]);
  ok((await txt(c)).includes('le matériel a été déplacé'), 'double validation → transfert exécuté');
  await c.goto(B + 'materiel.php?id=' + id);
  ok((await txt(c)).includes('Direction des Affaires Financières') && (await txt(c)).includes('Test de transfert'), 'matériel à la DAF + mouvement');

  // refus : c.beibakar demande un transfert, admin refuse
  await c.selectOption('form:has([value=transfert]) select', { label: 'DRH · Direction des Ressources Humaines' });
  await c.fill('[name=motif]', 'À refuser');
  await Promise.all([c.waitForNavigation(), c.click('form:has([value=transfert]) button[type=submit]')]);
  await a.goto(B + 'transferts.php');
  const art2 = a.locator('article', { hasText: 'À refuser' });
  await art2.locator('summary').click();
  await art2.locator('[name=motif_refus]').fill('Pas de besoin');
  await Promise.all([a.waitForNavigation(), art2.locator('button', { hasText: 'Confirmer le refus' }).click()]);
  ok((await txt(a)).includes('Demande refusée'), 'refus de transfert');

  // CRUD directions
  await a.goto(B + 'directions.php');
  await a.fill('[name=code]', 'DC' + suffixe); await a.fill('[name=nom]', 'Direction de la Communication');
  await Promise.all([a.waitForNavigation(), a.click('.formulaire-lateral button[type=submit]')]);
  ok((await txt(a)).includes('DC' + suffixe + ' ajoutée'), 'ajout direction');
  await a.click(`tr:has-text("DC${suffixe}") a[title=Modifier]`);
  await a.fill('[name=localisation]', 'Bâtiment C, 2e étage');
  await Promise.all([a.waitForNavigation(), a.click('.formulaire-lateral button[type=submit]')]);
  ok((await txt(a)).includes('Bâtiment C, 2e étage'), 'modification direction');
  await Promise.all([a.waitForNavigation(), a.click(`tr:has-text("DC${suffixe}") button[title=Supprimer]`)]);
  ok((await txt(a)).includes('Direction supprimée'), 'suppression direction');
  // CRUD catégories
  await a.goto(B + 'categories.php');
  await a.fill('[name=nom]', 'Véhicules ' + suffixe); await a.fill('[name=prefixe]', 'VH' + 'ABCDEFGHIJ'[suffixe % 10]);
  await Promise.all([a.waitForNavigation(), a.click('.formulaire-lateral button[type=submit]')]);
  ok((await txt(a)).includes('Véhicules ' + suffixe), 'ajout catégorie');
  await Promise.all([a.waitForNavigation(), a.click(`tr:has-text("Véhicules ${suffixe}") button[title=Supprimer]`)]);
  ok((await txt(a)).includes('Catégorie supprimée'), 'suppression catégorie');
  // utilisateurs
  await a.goto(B + 'utilisateurs.php');
  await a.fill('[name=nom_complet]', 'Test Utilisateur'); await a.fill('[name=identifiant]', 't.test' + suffixe);
  await a.selectOption('[name=direction_id]', { index: 1 }); await a.fill('[name=mot_de_passe]', 'motdepasse1');
  await Promise.all([a.waitForNavigation(), a.click('.formulaire-lateral button[type=submit]')]);
  ok((await txt(a)).includes('Compte créé'), 'création utilisateur');

  // recherche
  await a.goto(B + 'materiels.php?q=' + num);
  ok((await a.locator('tbody tr').count()) === 1, 'recherche par numéro');
  await a.goto(B + 'materiels.php?q=DAF');
  ok((await a.locator('tbody tr').count()) >= 5, 'recherche par direction');
  await a.goto(B + 'materiels.php?etat=reforme');
  ok((await a.locator('tbody tr').count()) >= 1 && (await a.locator('tbody .etat--en_service').count()) === 0, 'filtre réformés');
  // export CSV
  const r = await a.request.get(B + 'mouvements.php?export=csv');
  const csv = await r.text();
  ok(r.headers()['content-type'].includes('text/csv') && csv.split('\n').length > 10, 'export CSV (' + csv.split('\n').length + ' lignes)');
  // suppression matériel
  await a.goto(B + 'materiel.php?id=' + id);
  await Promise.all([a.waitForNavigation(), a.click('button:has-text("Supprimer")')]);
  ok((await txt(a)).includes('supprimé de l\'inventaire'), 'suppression matériel');
  // déconnexion
  await a.goto(B + 'deconnexion.php');
  await a.goto(B + 'index.php');
  ok(a.url().includes('connexion.php'), 'déconnexion');
  await browser.close();
  console.log(process.exitCode ? '\nDes tests ont échoué.' : '\nTous les tests sont passés.');
})();
