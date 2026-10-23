#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadParents, parentLabel, formatPhone } = require('./parents');
const { STATUS, NumberCache, createPacer, runChecks, sleep } = require('./runner');
const { writeReports } = require('./report');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RESULTS_DIR = path.join(ROOT, 'results');
const CACHE_FILE = path.join(RESULTS_DIR, 'cache-numeros.json');
const AUTH_DIR = path.join(ROOT, '.wwebjs_auth');
const MAX_SESSIONS = 4;
const RECONNECT_DELAY_S = 20;

const HELP = `
WhatsApp parent checker — finds the parents who have WhatsApp on none of their numbers.

Usage:  node src/index.js [parents-file] [options]
        (or double-click START.bat, or drag the file onto START.bat)

  parents-file        default: the .csv/.txt file in the "data" folder
  --dry-run           only read the file and show what would be checked
  --limit N           check only the first N parents (for a quick test)
  --delay MIN-MAX     seconds to wait between two lookups (default 2-4)
  --fresh             forget previous results and check every number again
  --headless          hide the browser window
  --pair NUMBER       log in with a pairing code instead of a QR code (e.g. --pair 22236000000)
  --browser PATH      use this Chrome/Edge executable
  --country CODE      country code for numbers written without one (default 222)
  --skip-selftest     do not run the safety self-test (not recommended)
  --no-open           do not open the Excel file at the end
`;

function parseArgs(argv) {
  const opts = { delay: [2, 4], country: '222' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--headless') opts.headless = true;
    else if (a === '--skip-selftest') opts.skipSelfTest = true;
    else if (a === '--no-open') opts.noOpen = true;
    else if (a === '--limit') opts.limit = parseInt(next(), 10);
    else if (a === '--pair') opts.pair = next().replace(/\D/g, '');
    else if (a === '--browser') opts.browser = next();
    else if (a === '--country') opts.country = next().replace(/\D/g, '');
    else if (a === '--delay') {
      const [min, max = min] = next().split('-').map(Number);
      if (!(min >= 0 && max >= min)) throw new Error('--delay expects MIN-MAX in seconds, e.g. 2-4');
      opts.delay = [min, max];
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a} (see --help)`);
    else rest.push(a);
  }
  opts.file = rest[0];
  return opts;
}

function findInputFile(given) {
  if (given) {
    if (!fs.existsSync(given)) throw new Error(`File not found: ${given}`);
    return path.resolve(given);
  }
  const candidates = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => /\.(csv|txt|tsv)$/i.test(f) && !/^PUT-YOUR-FILE-HERE/i.test(f)).map((f) => path.join(DATA_DIR, f))
    : [];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error(`Put your parents file (.csv) in the folder:\n   ${DATA_DIR}\nor drag the file onto START.bat.`);
  throw new Error(`Several files found in ${DATA_DIR}:\n   ${candidates.map((c) => path.basename(c)).join('\n   ')}\nKeep only one, or drag the right one onto START.bat.`);
}

// ---------- console + log file ----------
const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = color(32);
const red = color(31);
const yellow = color(33);
const gray = color(90);
const bold = color(1);
let logStream = null;

function writeLog(line) {
  if (logStream) logStream.write(`${line.replace(/\x1b\[\d+m/g, '')}\n`);
}

function print(line = '') {
  console.log(line);
  writeLog(line);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}min`;
}

function printParentLine({ result, i, total, stats }, started, remainingLive) {
  const n = String(i + 1).padStart(String(total).length);
  const label = parentLabel(result.parent, 60);
  let tag;
  let extra = '';
  switch (result.status) {
    case STATUS.WHATSAPP:
      tag = green('[WhatsApp]   ');
      extra = formatPhone(result.whatsappNumber);
      break;
    case STATUS.NO_WHATSAPP:
      tag = red('[NO WhatsApp]');
      extra = result.numbers.filter((x) => x.valid).map((x) => formatPhone(x.digits)).join(', ');
      break;
    case STATUS.NO_NUMBER:
      tag = gray('[no number]  ');
      break;
    default:
      tag = yellow('[recheck]    ');
  }
  const cached = result.numbers.some((x) => x.fromCache) ? gray(' (saved)') : '';
  let eta = '';
  if (stats.live > 2 && remainingLive > 0) {
    const perCheck = (Date.now() - started) / stats.live;
    eta = gray(`  ~${fmtDuration(perCheck * remainingLive)} left`);
  }
  print(`[${n}/${total}] ${tag} ${label}  ${gray(extra)}${cached}${eta}`);
}

function openFile(file) {
  if (process.platform !== 'win32' || !file) return;
  require('child_process').exec(`start "" "${file}"`, () => {});
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return print(HELP);

  const inputFile = findInputFile(opts.file);
  const data = loadParents(inputFile, { countryCode: opts.country });
  let parents = data.parents;
  if (opts.limit > 0) parents = parents.slice(0, opts.limit);

  const withNumbers = parents.filter((p) => p.phones.length);
  const allValid = parents.flatMap((p) => p.phones.filter((ph) => ph.valid));
  const invalid = parents.flatMap((p) => p.phones.filter((ph) => !ph.valid).map((ph) => ({ p, ph })));

  print(bold('WhatsApp parent checker'));
  print(`File:     ${inputFile}`);
  print(`Parents:  ${parents.length}  (${withNumbers.length} with at least one number, ${parents.length - withNumbers.length} with none)`);
  print(`Numbers:  ${allValid.length} to check at most (${new Set(allValid.map((x) => x.digits)).size} different)`);
  for (const { p, ph } of invalid) print(yellow(`  ! line ${p.line}: "${ph.raw}" is not a valid number (${ph.reason}) — ignored`));

  if (opts.dryRun) {
    print('');
    for (const p of parents) {
      print(`line ${String(p.line).padStart(3)}  ${parentLabel(p, 60).padEnd(60)}  ${p.phones.map((x) => (x.valid ? formatPhone(x.digits) : `INVALID(${x.raw})`)).join(', ') || gray('no number')}`);
    }
    print('\nDry run: nothing was checked on WhatsApp.');
    return;
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  logStream = fs.createWriteStream(path.join(RESULTS_DIR, 'journal.txt'), { flags: 'a' });
  writeLog(`\n===== ${new Date().toLocaleString('fr-FR')} — ${inputFile} =====`);

  const cache = new NumberCache(CACHE_FILE, { fresh: opts.fresh });
  const alreadyKnown = new Set(allValid.map((x) => x.digits).filter((d) => cache.get(d))).size;
  if (alreadyKnown) print(gray(`${alreadyKnown} numbers already checked in a previous run (use --fresh to check them again).`));

  const controller = new AbortController();
  let stopReason = null;
  let checking = false;
  process.on('SIGINT', () => {
    if (!checking || controller.signal.aborted) process.exit(130);
    print(yellow('\nStopping after the current lookup… (press Ctrl+C again to quit immediately)'));
    controller.abort();
  });

  const wa = require('./whatsapp');
  const waLog = (level, msg) => print(level === 'warn' ? yellow(msg) : msg);
  const started = Date.now();
  const unchecked = (list) => new Set(list.flatMap((p) => p.phones.filter((ph) => ph.valid && !cache.get(ph.digits)).map((ph) => ph.digits))).size;
  const totals = { live: 0, errors: 0, reused: alreadyKnown };
  let outcome = null;
  let lastProblem = null;
  const shown = new Map(); // parent index -> status already printed

  // If WhatsApp disconnects or the browser crashes, reconnect and continue where it stopped
  for (let session = 1; session <= MAX_SESSIONS && !controller.signal.aborted; session++) {
    if (session > 1) {
      print(yellow(`\nProblem: ${lastProblem}`));
      print(yellow(`Reconnecting in ${RECONNECT_DELAY_S}s and continuing where it stopped (attempt ${session}/${MAX_SESSIONS})…`));
      await sleep(RECONNECT_DELAY_S * 1000, controller.signal);
      if (controller.signal.aborted) break;
    }
    stopReason = null;
    print('');
    print(session === 1 ? 'Starting WhatsApp (first time: a QR code will appear — scan it with your phone)…' : 'Reconnecting to WhatsApp…');

    let client;
    try {
      client = await wa.connect({
        authDir: AUTH_DIR,
        headless: Boolean(opts.headless),
        browserPath: opts.browser,
        pairPhone: opts.pair,
        log: waLog,
        onDisconnected: (reason) => {
          stopReason = `WhatsApp disconnected (${reason})`;
          print(red(`\n${stopReason}`));
        },
      });
    } catch (err) {
      if (err.network) {
        lastProblem = err.message;
        continue;
      }
      throw new Error(`Could not start WhatsApp: ${err.message || err}`);
    }
    client.pupBrowser?.on('disconnected', () => {
      if (!stopReason) stopReason = 'the WhatsApp browser window was closed';
    });
    print(green('WhatsApp is ready.'));

    try {
      if (!opts.skipSelfTest) await wa.selfTest(client, (level, msg) => print(level === 'warn' ? yellow(msg) : green(msg)));

      if (!outcome) {
        print('');
        print(bold(`Checking ${parents.length} parents (stops at the first number that has WhatsApp)…`));
        print(gray('You can stop at any time with Ctrl+C: progress is saved and the next run continues from there.'));
        print('');
      }
      checking = true;
      outcome = await runChecks(parents, {
        check: (digits) => wa.checkNumber(client, digits),
        cache,
        signal: controller.signal,
        getStopReason: () => stopReason,
        pace: createPacer({
          minMs: opts.delay[0] * 1000,
          maxMs: opts.delay[1] * 1000,
          burstPauseMs: opts.delay[1] * 8000, // ~30s with the default delay
          signal: controller.signal,
          onPause: (ms) => print(gray(`  … short ${Math.round(ms / 1000)}s break to stay gentle with WhatsApp`)),
        }),
        log: (type, payload) => {
          if (type !== 'parent') return print(yellow(payload));
          const { numbers, status } = payload.result;
          // not reached yet (stopped): it will be checked after reconnecting
          if (status === STATUS.UNVERIFIED && !numbers.some((n) => n.result === 'error')) return;
          // after a reconnection, don't print again the parents already shown
          if (shown.get(payload.i) === status) return;
          shown.set(payload.i, status);
          printParentLine(payload, started, unchecked(parents.slice(payload.i + 1)));
        },
      });
      totals.live += outcome.stats.live;
      totals.errors += outcome.stats.errors;
      lastProblem = outcome.stopReason;
    } catch (err) {
      if (err.selfTestFailed) throw err;
      lastProblem = err.message || String(err);
    } finally {
      checking = false;
      await Promise.race([client.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
    }
    if (outcome && !outcome.stopReason) break;
  }

  if (!outcome) throw new Error(`Could not start WhatsApp: ${lastProblem}`);
  await finish({ results: outcome.results, runStop: outcome.stopReason, totals, started, opts, data });
}

async function finish({ results, runStop, totals, started, opts, data }) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const files = await writeReports(RESULTS_DIR, results, data);

  const noWa = results.filter((r) => r.status === STATUS.NO_WHATSAPP);
  print('');
  print(bold('================ RESULT ================'));
  if (noWa.length) {
    print(bold(red(`Parents with NO WhatsApp on any of their numbers (${noWa.length}):`)));
    for (const r of noWa) {
      print(`  line ${String(r.parent.line).padStart(3)}  ${parentLabel(r.parent, 60).padEnd(60)}  ${r.numbers.filter((x) => x.valid).map((x) => formatPhone(x.digits)).join(', ')}`);
    }
    print('');
  }
  print(`  Have WhatsApp ............ ${green(count(STATUS.WHATSAPP))}`);
  print(`  NO WhatsApp .............. ${red(count(STATUS.NO_WHATSAPP))}`);
  print(`  No number in the list .... ${gray(count(STATUS.NO_NUMBER))}  (also in the "sans WhatsApp" list)`);
  const unverified = count(STATUS.UNVERIFIED);
  print(`  To re-check .............. ${unverified ? yellow(unverified) : 0}`);
  print(gray(`  ${totals.live} lookups on WhatsApp, ${totals.reused} answers reused from a previous run, ${totals.errors} errors — ${fmtDuration(Date.now() - started)}`));
  print('');
  if (runStop) print(yellow(`Stopped early: ${runStop}\nRun START.bat again: it continues where it stopped.`));
  else if (unverified) print(yellow('Some numbers could not be checked (errors). Run START.bat again to retry only those.'));

  print('Files:');
  if (files.xlsx) print(`  ${files.xlsx}`);
  if (files.xlsxError) print(yellow(`  (Excel file not written: ${files.xlsxError})`));
  print(`  ${files.noWhatsappCsv}`);
  print(`  ${files.fullCsv}`);
  if (files.unverifiedCsv) print(`  ${files.unverifiedCsv}`);
  if (!opts.noOpen) openFile(files.xlsx);
}

// A stray error inside the WhatsApp library must not kill a 30-minute run
process.on('unhandledRejection', (err) => writeLog(`unhandled rejection: ${(err && err.stack) || err}`));

main()
  .then(() => {
    if (logStream) logStream.end();
    process.exitCode = process.exitCode || 0;
  })
  .catch((err) => {
    print(red(`\nERROR: ${err.message || err}`));
    if (logStream) logStream.end();
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 500).unref());
