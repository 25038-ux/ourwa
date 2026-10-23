'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOWNLOAD_DIR = path.join(ROOT, '.browser');

const exists = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Every browser that could run WhatsApp Web on this PC, best first.
 * Nothing is downloaded here: Chrome or Edge already installed on Windows is used.
 */
function installedBrowsers(explicitPath) {
  const env = process.env;
  const win = (base, rel) => base && path.join(base, rel);
  const list = [];
  if (explicitPath) list.push({ id: 'custom', name: 'Custom browser', path: explicitPath });
  for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA, env.ProgramW6432]) {
    list.push({ id: 'chrome', name: 'Google Chrome', path: win(base, 'Google/Chrome/Application/chrome.exe') });
  }
  for (const base of [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.ProgramW6432, env.LOCALAPPDATA]) {
    list.push({ id: 'edge', name: 'Microsoft Edge', path: win(base, 'Microsoft/Edge/Application/msedge.exe') });
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    list.push({ id: 'chrome', name: 'Google Chrome', path: p });
  }
  for (const b of downloadedBrowsers()) list.push(b);

  const seen = new Set();
  return list.filter((b) => {
    if (!b.path || seen.has(b.path.toLowerCase()) || !exists(b.path)) return false;
    seen.add(b.path.toLowerCase());
    return true;
  });
}

/** Chrome copies downloaded earlier (by this tool, or by puppeteer before). Broken copies are ignored. */
function downloadedBrowsers() {
  const found = [];
  let browsers;
  try {
    browsers = require('@puppeteer/browsers');
  } catch {
    return found;
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  for (const cacheDir of [DOWNLOAD_DIR, path.join(home, '.cache', 'puppeteer')]) {
    try {
      for (const b of browsers.getInstalledBrowsers({ cacheDir }) || []) {
        if (b.browser === browsers.Browser.CHROME && exists(b.executablePath)) {
          found.push({ id: 'chrome-download', name: `Chrome ${b.buildId} (downloaded)`, path: b.executablePath });
        }
      }
    } catch {
      // unreadable cache folder: ignore it
    }
  }
  return found;
}

/**
 * Last resort when neither Chrome nor Edge is installed: download Chrome into
 * the tool's own ".browser" folder. A half-downloaded copy (the cause of
 * "the browser folder exists but the executable is missing") is deleted first.
 */
async function downloadChrome(log) {
  const browsers = require('@puppeteer/browsers');
  const platform = browsers.detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for downloading Chrome');

  const buildIds = [];
  try {
    buildIds.push(require('puppeteer-core/internal/revisions.js').PUPPETEER_REVISIONS.chrome);
  } catch {
    // ignore, use the stable channel below
  }
  try {
    buildIds.push(await browsers.resolveBuildId(browsers.Browser.CHROME, platform, browsers.ChromeReleaseChannel.STABLE));
  } catch {
    // offline: only the pinned version can be tried
  }

  let lastError;
  for (const buildId of [...new Set(buildIds)]) {
    const executablePath = browsers.computeExecutablePath({ browser: browsers.Browser.CHROME, buildId, cacheDir: DOWNLOAD_DIR });
    if (exists(executablePath)) return executablePath;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await browsers.uninstall({ browser: browsers.Browser.CHROME, buildId, cacheDir: DOWNLOAD_DIR, platform }).catch(() => {});
        fs.rmSync(path.dirname(path.dirname(executablePath)), { recursive: true, force: true });
        log('info', `Downloading Chrome ${buildId} (about 150 MB, one time only)… attempt ${attempt}/3`);
        let lastPct = -10;
        await browsers.install({
          browser: browsers.Browser.CHROME,
          buildId,
          cacheDir: DOWNLOAD_DIR,
          downloadProgressCallback: (done, total) => {
            const pct = total ? Math.floor((done / total) * 100) : 0;
            if (pct >= lastPct + 10) {
              lastPct = pct;
              log('info', `  ${pct}%`);
            }
          },
        });
        if (exists(executablePath)) return executablePath;
        throw new Error('chrome.exe is missing after the download (antivirus?)');
      } catch (err) {
        lastError = err;
        log('warn', `  Chrome download failed: ${err.message}`);
      }
    }
  }
  throw new Error(`Could not download Chrome: ${lastError && lastError.message}`);
}

module.exports = { installedBrowsers, downloadChrome, DOWNLOAD_DIR };
