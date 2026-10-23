'use strict';

const fs = require('fs');
const path = require('path');
const { installedBrowsers, downloadChrome } = require('./browser');

const NETWORK_ERROR = /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Start WhatsApp Web and resolve once it is logged in and ready.
 * Tries Chrome, then Edge, then any other browser found; if none can start,
 * downloads Chrome. The browser that worked is remembered so its saved login
 * (one per browser) is reused and the QR code is only needed once.
 */
async function connect(opts) {
  const { authDir, browserPath, log } = opts;
  const stateFile = path.join(authDir, 'browser.json');
  const remembered = readJson(stateFile);

  if (browserPath && !fs.existsSync(browserPath)) throw new Error(`Browser not found: ${browserPath}`);
  const candidates = installedBrowsers(browserPath);
  if (remembered && !browserPath) {
    candidates.sort((a, b) => Number(b.path === remembered.path) - Number(a.path === remembered.path));
  }

  const failures = [];
  const tryBrowser = async (browser) => {
    log('info', `Opening WhatsApp Web in ${browser.name}…`);
    const client = await launch(browser, opts);
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ id: browser.id, name: browser.name, path: browser.path }, null, 1));
    return client;
  };

  for (const browser of candidates) {
    try {
      return await tryBrowser(browser);
    } catch (err) {
      if (!err.browserFailed) throw err;
      const reason = err.message.split('\n')[0].slice(0, 160);
      failures.push(`${browser.name}: ${reason}`);
      log('warn', `${browser.name} could not start (${reason}). Trying the next browser…`);
    }
  }

  log('warn', candidates.length ? 'No installed browser could start WhatsApp Web.' : 'Neither Chrome nor Edge was found on this PC.');
  const exe = await downloadChrome(log);
  try {
    return await tryBrowser({ id: 'chrome-download', name: 'Chrome (downloaded)', path: exe });
  } catch (err) {
    if (err.browserFailed) failures.push(`Chrome (downloaded): ${err.message.split('\n')[0].slice(0, 160)}`);
    throw new Error(`No browser could start.\n  ${failures.join('\n  ')}`);
  }
}

/** Launch one browser with WhatsApp Web. Errors before WhatsApp Web shows up are flagged `browserFailed`. */
async function launch(browser, { authDir, headless = false, pairPhone, log, onDisconnected }) {
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const qrcode = require('qrcode-terminal');

  const puppeteer = {
    headless,
    executablePath: browser.path,
    // Ctrl+C is handled by index.js, which finishes the current lookup before closing the browser
    handleSIGINT: false,
    timeout: 120000, // first start of a browser can be slow (antivirus scan)
    protocolTimeout: 300000,
    args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  };

  const client = new Client({
    // One saved login per browser: browser profiles must not be shared between Chrome and Edge
    authStrategy: new LocalAuth({ dataPath: authDir, clientId: browser.id }),
    puppeteer,
    ...(pairPhone ? { pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true } } : {}),
  });

  let reachedWhatsApp = false;
  let readyTimer;
  const ready = new Promise((resolve, reject) => {
    client.on('qr', (qr) => {
      reachedWhatsApp = true;
      log('info', '');
      log('info', 'Scan this QR code with your phone:');
      log('info', '  WhatsApp > Settings (or ⋮ menu) > Linked devices > Link a device');
      if (!headless) log('info', '  (the same QR code is also shown in the browser window)');
      qrcode.generate(qr, { small: true }, (art) => log('info', art));
    });
    client.on('code', (code) => {
      reachedWhatsApp = true;
      log('info', '');
      log('info', `Pairing code: ${code}`);
      log('info', '  On your phone: WhatsApp > Linked devices > Link a device > Link with phone number instead');
    });
    client.on('loading_screen', (percent) => {
      reachedWhatsApp = true;
      log('info', `Loading WhatsApp… ${percent}%`);
    });
    client.on('authenticated', () => {
      reachedWhatsApp = true;
      log('info', 'Logged in to WhatsApp. Loading chats…');
      clearTimeout(readyTimer);
      readyTimer = setTimeout(
        () => reject(new Error('WhatsApp Web logged in but never finished loading (5 min). WhatsApp probably changed something: run UPDATE.bat, then try again.')),
        5 * 60 * 1000,
      );
    });
    client.on('auth_failure', (msg) => reject(new Error(`WhatsApp login failed: ${msg}`)));
    client.on('ready', () => resolve());
  });
  client.on('disconnected', (reason) => onDisconnected?.(reason));

  try {
    await Promise.race([client.initialize().then(() => ready), ready]);
    return client;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (NETWORK_ERROR.test(error.message)) {
      error.message = `Cannot reach web.whatsapp.com — check the internet connection (${error.message})`;
      error.network = true;
    } else if (!reachedWhatsApp) {
      error.browserFailed = true;
    }
    await Promise.race([client.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
    throw error;
  } finally {
    clearTimeout(readyTimer);
  }
}

/** Ask WhatsApp whether this number (international digits, e.g. "22236303089") has an account. */
async function checkNumber(client, digits) {
  const wid = await client.getNumberId(digits);
  return { registered: Boolean(wid), wid: wid ? wid._serialized || `${wid.user}@${wid.server}` : null };
}

/** Lookup with a few retries, for the self-test only. */
async function checkWithRetry(client, digits) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await checkNumber(client, digits);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

function selfTestError(message) {
  const err = new Error(`Self-test failed: ${message} The lookup is not working, so the results would be wrong. Run UPDATE.bat, then START.bat again.`);
  err.selfTestFailed = true;
  return err;
}

/**
 * Prove the lookup works both ways before trusting it with 400 parents:
 *  - your own number must come back as "has WhatsApp"
 *  - impossible numbers must come back as "no WhatsApp"
 * Catches a broken WhatsApp Web update that would otherwise answer "yes"
 * (or "no") for everybody.
 */
async function selfTest(client, log) {
  const me = client.info && client.info.wid;
  if (me && me.server === 'c.us' && me.user) {
    const own = await checkWithRetry(client, me.user);
    if (!own.registered) throw selfTestError(`your own number (+${me.user}) was reported as NOT on WhatsApp.`);
    log('info', `Self-test 1/2 OK: your number +${me.user} is detected as a WhatsApp account.`);
  } else {
    log('warn', 'Self-test 1/2 skipped: could not read your own number from WhatsApp Web.');
  }

  for (const digits of ['22200000000', '22201010101']) {
    let res;
    try {
      res = await checkWithRetry(client, digits);
    } catch (err) {
      log('warn', `Self-test 2/2: lookup of a fake number failed (${err.message}); continuing.`);
      return;
    }
    if (res.registered) throw selfTestError(`the impossible number +${digits} was reported as having WhatsApp.`);
  }
  log('info', 'Self-test 2/2 OK: fake numbers are detected as having no WhatsApp.');
}

module.exports = { connect, checkNumber, selfTest };
