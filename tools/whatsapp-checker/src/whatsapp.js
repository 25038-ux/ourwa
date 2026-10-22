'use strict';

const fs = require('fs');
const path = require('path');

/** Use puppeteer's bundled Chrome; if its download failed, fall back to Chrome or Edge installed on the PC. */
function findBrowser(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) throw new Error(`Browser not found: ${explicitPath}`);
    return explicitPath;
  }
  try {
    const bundled = require('puppeteer').executablePath();
    if (bundled && fs.existsSync(bundled)) return undefined; // let whatsapp-web.js use it
  } catch {
    // puppeteer has no downloaded browser
  }
  const env = process.env;
  const candidates = [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * Start WhatsApp Web and resolve once it is logged in and ready.
 * The session is saved in `authDir`, so the QR code is only needed the first time.
 */
async function connect({ authDir, headless = false, browserPath, pairPhone, log, onDisconnected }) {
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const qrcode = require('qrcode-terminal');

  const executablePath = findBrowser(browserPath);
  // Ctrl+C is handled by index.js, which finishes the current lookup before closing the browser
  const puppeteer = { headless, handleSIGINT: false };
  if (executablePath) puppeteer.executablePath = executablePath;
  if (process.platform === 'linux') puppeteer.args = ['--no-sandbox', '--disable-setuid-sandbox'];

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer,
    ...(pairPhone ? { pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true } } : {}),
  });

  const ready = new Promise((resolve, reject) => {
    client.on('qr', (qr) => {
      log('info', '');
      log('info', 'Scan this QR code with your phone:');
      log('info', '  WhatsApp > Settings (or ⋮ menu) > Linked devices > Link a device');
      if (!headless) log('info', '  (the same QR code is also shown in the browser window)');
      qrcode.generate(qr, { small: true }, (art) => log('info', art));
    });
    client.on('code', (code) => {
      log('info', '');
      log('info', `Pairing code: ${code}`);
      log('info', '  On your phone: WhatsApp > Linked devices > Link a device > Link with phone number instead');
    });
    let readyTimer;
    client.on('loading_screen', (percent) => log('info', `Loading WhatsApp… ${percent}%`));
    client.on('authenticated', () => {
      log('info', 'Logged in to WhatsApp. Loading chats…');
      clearTimeout(readyTimer);
      readyTimer = setTimeout(
        () => reject(new Error('WhatsApp Web logged in but never finished loading (5 min). WhatsApp probably changed something: run UPDATE.bat, then try again.')),
        5 * 60 * 1000,
      );
    });
    client.on('auth_failure', (msg) => {
      clearTimeout(readyTimer);
      reject(new Error(`WhatsApp login failed: ${msg}`));
    });
    client.on('ready', () => {
      clearTimeout(readyTimer);
      resolve();
    });
  });

  client.on('disconnected', (reason) => onDisconnected?.(reason));

  await Promise.race([client.initialize().then(() => ready), ready]);
  return client;
}

/** Ask WhatsApp whether this number (international digits, e.g. "22236303089") has an account. */
async function checkNumber(client, digits) {
  const wid = await client.getNumberId(digits);
  return { registered: Boolean(wid), wid: wid ? wid._serialized || `${wid.user}@${wid.server}` : null };
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
    const own = await checkNumber(client, me.user);
    if (!own.registered) {
      throw new Error(`Self-test failed: your own number (+${me.user}) was reported as NOT on WhatsApp. The lookup is not working; results would be wrong.`);
    }
    log('info', `Self-test 1/2 OK: your number +${me.user} is detected as a WhatsApp account.`);
  } else {
    log('warn', 'Self-test 1/2 skipped: could not read your own number from WhatsApp Web.');
  }

  const impossible = ['22200000000', '22201010101'];
  for (const digits of impossible) {
    let res;
    try {
      res = await checkNumber(client, digits);
    } catch (err) {
      log('warn', `Self-test 2/2: lookup of a fake number threw (${err.message}); continuing.`);
      return;
    }
    if (res.registered) {
      throw new Error(`Self-test failed: the impossible number +${digits} was reported as having WhatsApp. The lookup is not working; results would be wrong.`);
    }
  }
  log('info', 'Self-test 2/2 OK: fake numbers are detected as having no WhatsApp.');
}

module.exports = { connect, checkNumber, selfTest, findBrowser };
