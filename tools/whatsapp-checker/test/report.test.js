'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeReports } = require('../src/report');
const { runChecks } = require('../src/runner');
const { loadParents } = require('../src/parents');

test('writes the lists in the same format as the input file, plus an Excel file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-report-'));
  const input = path.join(dir, 'in.csv');
  const text = [
    'Parent\tEnfants\tTéléphone 1\tTéléphone 2',
    'Avec\tA —\t+222 22 00 00 01\t',
    'Sans\tB —\t+222 22 00 00 02\t+222 22 00 00 03',
    'Rien\tC —\tAUCUN NUMÉRO\t',
  ].join('\r\n');
  fs.writeFileSync(input, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  const data = loadParents(input);
  const { results } = await runChecks(data.parents, {
    check: async (d) => ({ registered: d === '22222000001' }),
  });
  const files = await writeReports(path.join(dir, 'out'), results, data);

  const buf = fs.readFileSync(files.noWhatsappCsv);
  assert.deepStrictEqual([...buf.subarray(0, 2)], [0xff, 0xfe], 'UTF-16 LE BOM like the input');
  const lines = buf.subarray(2).toString('utf16le').trim().split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.match(lines[1], /^3\tSans\t/);
  assert.match(lines[1], /Aucun des 2 numéros n’a WhatsApp/);
  assert.match(lines[2], /^4\tRien\t.*Aucun numéro de téléphone/);

  const full = fs.readFileSync(files.fullCsv).subarray(2).toString('utf16le');
  assert.match(full, /Avec\tA —\t\+222 22 00 00 01\t\tA WhatsApp\t\+222 22 00 00 01/);
  assert.ok(fs.statSync(files.xlsx).size > 1000);
  assert.strictEqual(files.unverifiedCsv, undefined);
});
