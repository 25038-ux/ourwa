'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runChecks, NumberCache, STATUS } = require('../src/runner');
const { normalizePhone } = require('../src/parents');

const parent = (name, ...numbers) => ({
  line: 0,
  name,
  children: '',
  cells: [name],
  phones: numbers.map((n) => ({ raw: n, ...normalizePhone(n) })),
});

function fakeWhatsApp(registered, calls = []) {
  return async (digits) => {
    calls.push(digits);
    return { registered: registered.includes(digits) };
  };
}

const fast = { retryDelaysMs: [0, 0], timeoutMs: 1000 };

test('checks every number and lists all the WhatsApp numbers of a parent', async () => {
  const calls = [];
  const { results } = await runChecks([parent('A', '22200000001', '22200000002', '22200000003')], {
    ...fast,
    check: fakeWhatsApp(['22200000002', '22200000003'], calls),
  });
  assert.deepStrictEqual(calls, ['22200000001', '22200000002', '22200000003']);
  assert.strictEqual(results[0].status, STATUS.WHATSAPP);
  assert.deepStrictEqual(results[0].whatsappNumbers, ['22200000002', '22200000003']);
  assert.deepStrictEqual(results[0].numbers.map((n) => n.result), ['no-whatsapp', 'whatsapp', 'whatsapp']);
  assert.strictEqual(results[0].incomplete, false);
});

test('with stopAtFirst, stops at the first number that has WhatsApp', async () => {
  const calls = [];
  const { results } = await runChecks([parent('A', '22200000001', '22200000002', '22200000003')], {
    ...fast,
    stopAtFirst: true,
    check: fakeWhatsApp(['22200000002', '22200000003'], calls),
  });
  assert.deepStrictEqual(calls, ['22200000001', '22200000002']);
  assert.deepStrictEqual(results[0].whatsappNumbers, ['22200000002']);
  assert.strictEqual(results[0].numbers[2].result, 'not-checked');
});

test('a parent is "no WhatsApp" only when every number was answered "no"', async () => {
  const { results } = await runChecks([parent('B', '22200000001', '22200000002'), parent('C')], {
    ...fast,
    check: fakeWhatsApp([]),
  });
  assert.strictEqual(results[0].status, STATUS.NO_WHATSAPP);
  assert.strictEqual(results[1].status, STATUS.NO_NUMBER);
});

test('errors are retried, and never counted as "no WhatsApp"', async () => {
  let n = 0;
  const flaky = async () => {
    n++;
    if (n < 3) throw new Error('boom');
    return { registered: false };
  };
  const { results } = await runChecks([parent('D', '22200000001')], { ...fast, check: flaky });
  assert.strictEqual(n, 3);
  assert.strictEqual(results[0].status, STATUS.NO_WHATSAPP);

  const broken = async () => {
    throw new Error('down');
  };
  const out = await runChecks([parent('E', '22200000001', '22200000002')], { ...fast, check: broken, maxConsecutiveFailures: 5 });
  assert.strictEqual(out.results[0].status, STATUS.UNVERIFIED);
  assert.deepStrictEqual(out.results[0].numbers.map((x) => x.result), ['error', 'error']);
});

test('error on one number but WhatsApp on the next still counts as WhatsApp', async () => {
  const check = async (d) => {
    if (d === '22200000001') throw new Error('down');
    return { registered: true };
  };
  const { results } = await runChecks([parent('F', '22200000001', '22200000002')], { ...fast, check });
  assert.strictEqual(results[0].status, STATUS.WHATSAPP);
  assert.deepStrictEqual(results[0].whatsappNumbers, ['22200000002']);
  assert.strictEqual(results[0].incomplete, true, 'the failed number may also have WhatsApp');
});

test('hung lookups time out instead of blocking forever', async () => {
  const hang = () => new Promise(() => {});
  const { results } = await runChecks([parent('G', '22200000001')], { retryDelaysMs: [], timeoutMs: 50, check: hang });
  assert.strictEqual(results[0].status, STATUS.UNVERIFIED);
  assert.match(results[0].numbers[0].error, /timed out/);
});

test('stops the run after repeated failures and marks the rest "to re-check"', async () => {
  const broken = async () => {
    throw new Error('Session closed');
  };
  const parents = [parent('H', '22200000001'), parent('I', '22200000002'), parent('J', '22200000003'), parent('K')];
  const { results, stopReason } = await runChecks(parents, { ...fast, check: broken, maxConsecutiveFailures: 2 });
  assert.match(stopReason, /in a row.*Session closed/);
  assert.deepStrictEqual(results.map((r) => r.status), [STATUS.UNVERIFIED, STATUS.UNVERIFIED, STATUS.UNVERIFIED, STATUS.NO_NUMBER]);
});

test('Ctrl+C stops cleanly and keeps all parents in the report', async () => {
  const controller = new AbortController();
  const check = async () => {
    controller.abort();
    return { registered: false };
  };
  const { results, stopReason } = await runChecks([parent('L', '22200000001'), parent('M', '22200000002')], {
    ...fast,
    check,
    signal: controller.signal,
  });
  assert.ok(stopReason);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].status, STATUS.NO_WHATSAPP);
  assert.strictEqual(results[1].status, STATUS.UNVERIFIED);
});

test('saved answers are reused: resume after a stop, and shared numbers are checked once', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-cache-')), 'cache.json');
  const calls = [];
  const parents = [parent('N', '22200000001'), parent('O', '22200000001', '22200000002')];
  await runChecks(parents, { ...fast, check: fakeWhatsApp([], calls), cache: new NumberCache(file) });
  assert.deepStrictEqual(calls, ['22200000001', '22200000002']);

  const again = [];
  const { results, stats } = await runChecks(parents, { ...fast, check: fakeWhatsApp([], again), cache: new NumberCache(file) });
  assert.deepStrictEqual(again, []);
  assert.strictEqual(stats.cached, 3);
  assert.strictEqual(results[1].status, STATUS.NO_WHATSAPP);

  const fresh = [];
  await runChecks(parents, { ...fast, check: fakeWhatsApp([], fresh), cache: new NumberCache(file, { fresh: true }) });
  assert.strictEqual(fresh.length, 2);
});
