// LE MANDATAIRE DU CONTENEUR RENDER — en Node, sans dépendance, à la place de
// Caddy : le binaire de caddy:2-alpine porte une capacité de fichier que le bac
// à sable de Render refuse d'exécuter (« Operation not permitted »), et un
// paquet Debian de plus est une pièce de plus qui peut manquer. Ceci fait
// exactement trois choses :
//   /_sante                                → 200 « ok » (la sonde de Render)
//   Host api.<PUBLIC_DOMAIN> ou *.onrender  → l'API   (127.0.0.1:3001)
//   tout autre Host (nour., admin., …)      → le site (127.0.0.1:3000)
// Render termine le TLS ; ici c'est du HTTP. X-Forwarded-Host / -Proto / -For
// sont posés pour que le site lise l'école dans le nom d'hôte et que Next
// accepte ses actions serveur (origine = hôte transmis).
import http from 'node:http';
import fs from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 10000);
const DOMAINE = (process.env.PUBLIC_DOMAIN ?? '').toLowerCase();
const RENDER_HOST = (process.env.RENDER_EXTERNAL_HOSTNAME ?? '').toLowerCase();
const API = { host: '127.0.0.1', port: 3001 };
const WEB = { host: '127.0.0.1', port: 3000 };

function cible(hostHeader) {
  const host = (hostHeader ?? '').split(':')[0].toLowerCase();
  if ((DOMAINE && host === `api.${DOMAINE}`) || (RENDER_HOST && host === RENDER_HOST)) return API;
  return WEB;
}

// L'API et le site sont-ils levés ? La sonde de Render ne dit « sain » que
// quand les deux répondent : jusque-là Render garde sa propre page d'attente
// au lieu de nous laisser servir des 503. Testé toutes les deux secondes.
let apiPrete = false;
let webPret = false;
const DEMARRE_A = Date.now();
// Passé ce délai sans API ni site, la sonde dit la vérité (503) : Render
// redémarre le conteneur au lieu de garder à vie une page d'attente.
const GRACE_MS = 5 * 60 * 1000;
function sonder(port, sur) {
  const r = http.get({ host: '127.0.0.1', port, path: port === 3001 ? '/health' : '/login', timeout: 4000 }, (resp) => {
    sur(resp.statusCode !== undefined && resp.statusCode < 500);
    resp.resume();
  });
  r.on('error', () => sur(false));
  r.on('timeout', () => { r.destroy(); sur(false); });
}
setInterval(() => {
  sonder(3001, (ok) => { if (ok !== apiPrete) console.log(`API ${ok ? 'prête' : 'indisponible'}`); apiPrete = ok; });
  sonder(3000, (ok) => { if (ok !== webPret) console.log(`site ${ok ? 'prêt' : 'indisponible'}`); webPret = ok; });
}, 2000);

// RESTER ÉVEILLÉ. L'offre gratuite endort le service après quinze minutes sans
// requête entrante, et le réveil coûte une minute au premier visiteur — c'est
// ce qu'une démonstration ne peut pas se permettre. Une requête vers notre
// propre adresse publique, toutes les dix minutes, compte comme entrante.
// KEEP_AWAKE=0 pour l'éteindre.
if (RENDER_HOST && (process.env.KEEP_AWAKE ?? '1') !== '0') {
  setInterval(() => {
    import('node:https').then(({ default: https }) => {
      https.get({ host: RENDER_HOST, path: '/_sante', timeout: 20000 }, (r) => r.resume()).on('error', () => {});
    });
  }, 10 * 60 * 1000);
}

const PAGE_ATTENTE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Démarrage… — El Ourwa</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f1ea;color:#3b2f2a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.c{background:#fff;padding:2rem 2.5rem;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);max-width:420px;text-align:center}
h1{font-size:1.2rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#6b5a52}.b{display:inline-block;width:38px;height:38px;border:4px solid #e7d9c9;border-top-color:#c67139;border-radius:50%;animation:s 1s linear infinite;margin-bottom:1rem}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="c"><div class="b"></div><h1>Le serveur démarre…</h1><p>Après quelques minutes sans visite, le service de démonstration se rendort ; il se réveille en moins d'une minute.</p><p>Cette page se rafraîchit toute seule.</p></div></body></html>`;

// LE JOURNAL, LISIBLE DE L'EXTÉRIEUR — gardé par le mot de passe de app_user
// (dans l'environnement Render, que le propriétaire voit). Sans lui, rien.
// JOURNAL_KEY, si posée, remplace le mot de passe de la base (préférable : la
// clé du journal ne donne alors rien d'autre). Comparaison en temps constant,
// et cinq échecs par minute au plus : pas d'oracle pour deviner la clé.
let echecsJournal = 0;
setInterval(() => { echecsJournal = 0; }, 60 * 1000);
function journal(res, url) {
  const cle = new URL(url, 'http://x').searchParams.get('cle') ?? '';
  const attendu = process.env.JOURNAL_KEY || process.env.APP_USER_PASSWORD || '';
  const a = Buffer.from(cle, 'utf8'); const b = Buffer.from(attendu, 'utf8');
  const bon = attendu.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!bon) { echecsJournal += 1; res.writeHead(echecsJournal > 5 ? 429 : 404); res.end(); return; }
  if (echecsJournal > 5) { res.writeHead(429); res.end(); return; }
  const lire = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(-80).join('\n'); } catch { return '(vide)'; } };
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end([
    `== état: api ${apiPrete ? 'prête' : 'indisponible'} · site ${webPret ? 'prêt' : 'indisponible'} · ${new Date().toISOString()}`,
    '', '== /tmp/demarrage.log', lire('/tmp/demarrage.log'),
    '', '== /tmp/api.log', lire('/tmp/api.log'),
    '', '== /tmp/site.log', lire('/tmp/site.log'), '',
  ].join('\n'));
}

const serveur = http.createServer((req, res) => {
  if (req.url?.startsWith('/_journal')) return journal(res, req.url);
  if (req.url === '/_sante') {
    // ⚠ TOUJOURS 200 DÈS QUE LE MANDATAIRE ÉCOUTE. Render ne bascule sur la
    // nouvelle image que si cette sonde répond 200 dans son délai ; répondre
    // 503 tant que l'API et le site ne sont pas levés (base froide, première
    // requête lente) faisait échouer le DÉPLOIEMENT entier et gardait
    // l'ancienne image en service. L'état réel est dans le corps : `ok`
    // quand tout est levé, `demarrage` sinon — et les visiteurs voient la
    // page d'attente, pas une erreur.
    const ok = apiPrete && webPret;
    const enPanne = !ok && Date.now() - DEMARRE_A > GRACE_MS;
    res.writeHead(enPanne ? 503 : 200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(ok ? 'ok' : enPanne ? 'en panne' : 'demarrage');
    return;
  }
  const vers = cible(req.headers.host);
  const enTetes = { ...req.headers };
  // ⚠ CES EN-TÊTES NE SONT CRUS QUE DEPUIS UN PAIR DE CONFIANCE — c'est-à-dire
  // nous. Un client qui les envoie lui-même choisirait son école, son adresse
  // (et le verrou des quinze essais) ou son User-Agent : on les efface avant de
  // relayer, et seuls les nôtres passent.
  delete enTetes['x-school-slug'];
  delete enTetes['x-client-ip'];
  delete enTetes['x-client-user-agent'];
  // Render ajoute l'adresse qu'il a vue À LA FIN de X-Forwarded-For (un client
  // peut en envoyer un faux devant) : la vraie adresse est la dernière entrée.
  const entrees = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const adresse = entrees[entrees.length - 1] || req.socket.remoteAddress || '';
  enTetes['x-forwarded-for'] = adresse;
  enTetes['x-forwarded-host'] = enTetes['x-forwarded-host'] ?? req.headers.host ?? '';
  enTetes['x-forwarded-proto'] = enTetes['x-forwarded-proto'] ?? 'https';
  // Qui est vraiment devant l'écran, pour l'API (qui ne lit pas X-Forwarded-For,
  // seulement X-Client-IP d'un pair de confiance — nous, sur 127.0.0.1).
  if (vers === API) {
    enTetes['x-client-ip'] = adresse;
    if (req.headers['user-agent']) enTetes['x-client-user-agent'] = req.headers['user-agent'];
  }

  const sortie = http.request(
    { host: vers.host, port: vers.port, method: req.method, path: req.url, headers: enTetes },
    (reponse) => {
      res.writeHead(reponse.statusCode ?? 502, reponse.headers);
      reponse.pipe(res);
    },
  );
  sortie.on('error', (e) => {
    // Le service derrière n'est pas encore levé (les deux Node démarrent en
    // parallèle) : 503 — une page d'attente qui se rafraîchit pour un
    // navigateur, un JSON pour l'application (qui réessaie).
    if (res.headersSent) { res.end(); return; }
    const navigateur = /text\/html/.test(String(req.headers.accept ?? ''));
    if (navigateur) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' });
      res.end(PAGE_ATTENTE);
    } else {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '5' });
      res.end(JSON.stringify({ message: 'Le serveur démarre, réessayez dans quelques secondes.', code: e.code ?? e.message }));
    }
  });
  req.pipe(sortie);
});

serveur.keepAliveTimeout = 65_000;
serveur.listen(PORT, '0.0.0.0', () => {
  console.log(`mandataire sur :${PORT} — api.${DOMAINE || '?'} et ${RENDER_HOST || '?'} → :3001, le reste → :3000`);
});
