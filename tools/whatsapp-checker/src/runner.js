'use strict';

const fs = require('fs');
const path = require('path');

const STATUS = {
  WHATSAPP: 'WHATSAPP',
  NO_WHATSAPP: 'NO_WHATSAPP',
  NO_NUMBER: 'NO_NUMBER',
  UNVERIFIED: 'UNVERIFIED',
};

/** Sleep that wakes up early when `signal` is aborted (Ctrl+C). */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Remembers every number already checked, so an interrupted run resumes
 * where it stopped and a number shared by two parents is only checked once.
 */
class NumberCache {
  constructor(file, { fresh = false } = {}) {
    this.file = file;
    this.data = {};
    if (!fresh && file && fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
        this.data = {};
      }
    }
  }

  get(digits) {
    return this.data[digits];
  }

  set(digits, entry) {
    this.data[digits] = { ...entry, checkedAt: new Date().toISOString() };
    this.save();
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const json = JSON.stringify(this.data, null, 1);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, json);
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      // Antivirus / OneDrive can briefly lock the file on Windows
      fs.writeFileSync(this.file, json);
      fs.rmSync(tmp, { force: true });
    }
  }
}

/** Random human-like delay between live checks, plus a longer break every `burstSize` checks. */
function createPacer({ minMs = 2000, maxMs = 4000, burstSize = 40, burstPauseMs = 30000, signal, onPause } = {}) {
  let liveChecks = 0;
  return async function pace() {
    if (liveChecks > 0) {
      if (burstSize > 0 && burstPauseMs > 0 && liveChecks % burstSize === 0) {
        onPause?.(burstPauseMs);
        await sleep(burstPauseMs, signal);
      } else {
        await sleep(minMs + Math.random() * Math.max(0, maxMs - minMs), signal);
      }
    }
    liveChecks++;
  };
}

/**
 * Check every parent. By default every number of every parent is checked, so
 * all of a parent's WhatsApp numbers are listed. With `stopAtFirst`, a parent's
 * remaining numbers are skipped once one has WhatsApp.
 *
 * `check(digits)` must resolve to { registered: boolean, wid?: string } or throw.
 * A number is only counted as "no WhatsApp" when WhatsApp itself answered so;
 * errors never turn into "no WhatsApp" — they make the parent UNVERIFIED.
 */
async function runChecks(parents, opts) {
  const {
    check,
    cache = new NumberCache(null),
    pace = async () => {},
    log = () => {},
    signal,
    getStopReason = () => null,
    retryDelaysMs = [5000, 15000, 30000],
    timeoutMs = 45000,
    maxConsecutiveFailures = 3,
    stopAtFirst = false,
  } = opts;

  const results = [];
  let stopReason = null;
  let consecutiveFailures = 0;
  const stats = { live: 0, cached: 0, errors: 0 };

  const currentStop = () => stopReason || (signal?.aborted ? 'stopped with Ctrl+C' : null) || getStopReason();

  async function checkWithRetry(digits) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await withTimeout(Promise.resolve().then(() => check(digits)), timeoutMs, 'WhatsApp lookup');
      } catch (err) {
        const reason = getStopReason();
        if (reason || signal?.aborted || attempt >= retryDelaysMs.length) {
          return { error: (err && err.message) || String(err) };
        }
        log('warn', `  ! lookup failed (${(err && err.message) || err}), retry ${attempt + 1}/${retryDelaysMs.length} in ${retryDelaysMs[attempt] / 1000}s`);
        await sleep(retryDelaysMs[attempt], signal);
      }
    }
  }

  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];
    const numbers = parent.phones.map((p) => ({ ...p, result: p.valid ? 'not-checked' : 'invalid' }));
    const result = { parent, numbers, status: STATUS.UNVERIFIED, whatsappNumbers: [], incomplete: false, index: i };
    results.push(result);

    if (!parent.phones.length) {
      result.status = STATUS.NO_NUMBER;
      log('parent', { result, i, total: parents.length, stats });
      continue;
    }

    for (const num of numbers) {
      if (!num.valid) continue;
      if (currentStop()) break;

      let answer = cache.get(num.digits);
      if (answer) {
        num.fromCache = true;
        stats.cached++;
      } else {
        await pace();
        if (currentStop()) break;
        stats.live++;
        answer = await checkWithRetry(num.digits);
        if (answer.error) {
          stats.errors++;
          num.result = 'error';
          num.error = answer.error;
          consecutiveFailures++;
          log('warn', `  ! ${num.digits}: ${answer.error}`);
          if (consecutiveFailures >= maxConsecutiveFailures) {
            stopReason = `${consecutiveFailures} numbers in a row could not be checked (last error: ${answer.error})`;
            break;
          }
          continue;
        }
        consecutiveFailures = 0;
        answer = { whatsapp: Boolean(answer.registered), wid: answer.wid || null };
        cache.set(num.digits, answer);
      }

      num.result = answer.whatsapp ? 'whatsapp' : 'no-whatsapp';
      if (answer.whatsapp) {
        result.whatsappNumbers.push(num.digits);
        if (stopAtFirst) break;
      }
    }

    if (result.whatsappNumbers.length) {
      result.status = STATUS.WHATSAPP;
      // has WhatsApp for sure, but some numbers could not be checked: the list of WhatsApp numbers may be incomplete
      result.incomplete = !stopAtFirst && numbers.some((n) => n.result === 'error' || n.result === 'not-checked');
    }
    else if (numbers.every((n) => n.result === 'no-whatsapp' || n.result === 'invalid')) result.status = STATUS.NO_WHATSAPP;
    else result.status = STATUS.UNVERIFIED;

    log('parent', { result, i, total: parents.length, stats });

    if (currentStop()) {
      stopReason = currentStop();
      // Leave the remaining parents in the report as "not verified"
      for (let j = i + 1; j < parents.length; j++) {
        const p = parents[j];
        results.push({
          parent: p,
          numbers: p.phones.map((ph) => ({ ...ph, result: ph.valid ? 'not-checked' : 'invalid' })),
          status: p.phones.length ? STATUS.UNVERIFIED : STATUS.NO_NUMBER,
          whatsappNumbers: [],
          incomplete: false,
          index: j,
        });
      }
      break;
    }
  }

  return { results, stopReason, stats };
}

module.exports = { STATUS, NumberCache, createPacer, runChecks, sleep, withTimeout };
