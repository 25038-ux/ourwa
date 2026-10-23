'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeReports } = require('../src/report');
const { runChecks } = require('../src/runner');
const { loadParents } = require('../src/parents');

test('writes the "with WhatsApp" and "without WhatsApp" lists, in the input format and in Excel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-report-'));
  const input = path.join(dir, 'in.csv');
  const text = [
    'Parent\tEnfants\tTéléphone 1\tTéléphone 2',
    'Avec\tA —\t+222 22 00 00 01\t',
    'Sans\tB —\t+222 22 00 00 02\t+222 22 00 00 03',
    'Rien\tC —\tAUCUN NUMÉRO\t',
    'Deux\tD —\t+222 22 00 00 04\t+222 22 00 00 05',
    'Un sur deux\tE —\t+222 22 00 00 06\t+222 22 00 00 07',
  ].join('\r\n');
  fs.writeFileSync(input, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  const data = loadParents(input);
  const registered = ['22222000001', '22222000004', '22222000005', '22222000007'];
  const { results } = await runChecks(data.parents, { check: async (d) => ({ registered: registered.includes(d) }) });
  const files = await writeReports(path.join(dir, 'out'), results, data);
  const read = (file) => {
    const buf = fs.readFileSync(file);
    assert.deepStrictEqual([...buf.subarray(0, 2)], [0xff, 0xfe], 'UTF-16 LE BOM like the input');
    return buf.subarray(2).toString('utf16le').replace(/\r\n$/, '').split('\r\n');
  };

  const avec = read(files.withWhatsappCsv);
  assert.strictEqual(avec[0], 'Ligne\tParent\tEnfants\tNuméro(s) WhatsApp\tNb WhatsApp\tAutres numéros (sans WhatsApp)\tRemarque');
  assert.deepStrictEqual(avec.slice(1), [
    '2\tAvec\tA —\t+222 22 00 00 01\t1\t\t',
    '5\tDeux\tD —\t+222 22 00 00 04 / +222 22 00 00 05\t2\t\t',
    '6\tUn sur deux\tE —\t+222 22 00 00 07\t1\t+222 22 00 00 06\t',
  ]);

  const sans = read(files.noWhatsappCsv);
  assert.strictEqual(sans[0], 'Ligne\tParent\tEnfants\tNuméros\tRaison');
  assert.deepStrictEqual(sans.slice(1), [
    '3\tSans\tB —\t+222 22 00 00 02 / +222 22 00 00 03\tAucun des 2 numéros n’a WhatsApp',
    '4\tRien\tC —\tAUCUN NUMÉRO\tAucun numéro de téléphone dans la liste',
  ]);

  const full = read(files.fullCsv).join('\n');
  assert.match(full, /Deux\tD —\t\+222 22 00 00 04\t\+222 22 00 00 05\tA WhatsApp\t\+222 22 00 00 04 \/ \+222 22 00 00 05/);
  assert.ok(fs.statSync(files.xlsx).size > 1000);
  assert.strictEqual(files.unverifiedCsv, undefined);
});
