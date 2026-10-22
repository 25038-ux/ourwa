'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizePhone, extractPhones, loadParents, parseDelimited, parentLabel } = require('../src/parents');

function tmpFile(name, buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-checker-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

const SAMPLE = [
  'Parent (nom du compte)\tEnfants inscrits 2026-2027\tTéléphone 1 (connexion)\tTéléphone 2\tTéléphone 3',
  'Abdallahi\tAhmed Abdallahi — / Ismail Abdallahi —\tAUCUN NUMÉRO\t\t',
  'Tahre\tAminetou Nouey — / Sidi Med Nouey —\t+222 48 02 80 80\t+222 33 35 35 00\t+222 36 56 10 46',
  'P M\tLemneya Jidou —\t+222 22 49 13 80\t+222 22 49 13 80\t',
  'Bad\tX —\t+222 12 34\t\t',
].join('\r\n');

test('normalizePhone handles the usual ways numbers are written', () => {
  assert.deepStrictEqual(normalizePhone('+222 22 22 42 21'), { digits: '22222224221', valid: true });
  assert.deepStrictEqual(normalizePhone('00222 36303089'), { digits: '22236303089', valid: true });
  assert.deepStrictEqual(normalizePhone('36 30 30 89'), { digits: '22236303089', valid: true });
  assert.deepStrictEqual(normalizePhone('22236303089'), { digits: '22236303089', valid: true });
  assert.strictEqual(normalizePhone('+222 12 34').valid, false);
  assert.deepStrictEqual(normalizePhone('+33 6 12 34 56 78'), { digits: '33612345678', valid: true });
});

test('extractPhones ignores "AUCUN NUMÉRO" and splits several numbers in one cell', () => {
  assert.deepStrictEqual(extractPhones('AUCUN NUMÉRO'), []);
  assert.deepStrictEqual(extractPhones(''), []);
  const two = extractPhones('+222 36 30 41 89 / 22 30 41 89');
  assert.deepStrictEqual(two.map((p) => p.digits), ['22236304189', '22222304189']);
});

test('parseDelimited handles quotes and embedded delimiters', () => {
  const rows = parseDelimited('a;b\r\n"x;y";"say ""hi"""\r\n', ';');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x;y', 'say "hi"']]);
});

test('loadParents reads an Excel "Unicode text" export (UTF-16 LE + tabs)', () => {
  const file = tmpFile('parents.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, 'utf16le')]));
  const { parents, encoding, delimiter, columns } = loadParents(file);
  assert.strictEqual(encoding, 'utf16le');
  assert.strictEqual(delimiter, '\t');
  assert.deepStrictEqual(columns, { parent: 0, children: 1, phones: [2, 3, 4] });
  assert.strictEqual(parents.length, 4);
  assert.strictEqual(parents[0].line, 2);
  assert.deepStrictEqual(parents[0].phones, []);
  assert.deepStrictEqual(parents[1].phones.map((p) => p.digits), ['22248028080', '22233353500', '22236561046']);
  assert.deepStrictEqual(parents[2].phones.map((p) => p.digits), ['22222491380'], 'duplicate number kept once');
  assert.strictEqual(parents[3].phones[0].valid, false);
  assert.strictEqual(parentLabel(parents[1]), 'Tahre (Aminetou Nouey, Sidi Med Nouey)');
});

test('loadParents also reads UTF-8 and semicolon CSV', () => {
  const file = tmpFile('parents.csv', Buffer.from(`﻿${SAMPLE.replace(/\t/g, ';')}`, 'utf8'));
  const { parents, encoding, delimiter } = loadParents(file);
  assert.strictEqual(encoding, 'utf8');
  assert.strictEqual(delimiter, ';');
  assert.strictEqual(parents[0].name, 'Abdallahi');
  assert.strictEqual(parents[1].phones.length, 3);
});
