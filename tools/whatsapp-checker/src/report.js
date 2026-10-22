'use strict';

const fs = require('fs');
const path = require('path');
const { STATUS } = require('./runner');
const { formatPhone } = require('./parents');

const STATUS_LABEL = {
  [STATUS.WHATSAPP]: 'A WhatsApp',
  [STATUS.NO_WHATSAPP]: 'Pas de WhatsApp',
  [STATUS.NO_NUMBER]: 'Aucun numéro',
  [STATUS.UNVERIFIED]: 'À revérifier',
};

const NUMBER_LABEL = {
  whatsapp: 'WhatsApp ✓',
  'no-whatsapp': 'pas de WhatsApp',
  invalid: 'numéro invalide',
  error: 'erreur',
  'not-checked': 'non vérifié',
};

function numberDetail(result) {
  const found = Boolean(result.whatsappNumber);
  return result.numbers
    .map((n) => {
      let label = NUMBER_LABEL[n.result];
      if (n.result === 'not-checked' && found) label = 'non vérifié (WhatsApp déjà trouvé)';
      if (n.result === 'invalid') label += ` (${n.reason})`;
      if (n.result === 'error') label += ` (${n.error})`;
      return `${n.valid ? formatPhone(n.digits) : n.raw} : ${label}`;
    })
    .join(' | ');
}

function reason(result) {
  if (result.status === STATUS.NO_NUMBER) return 'Aucun numéro de téléphone dans la liste';
  const checked = result.numbers.filter((n) => n.result === 'no-whatsapp').length;
  const invalid = result.numbers.filter((n) => n.result === 'invalid').length;
  const parts = [];
  if (checked) parts.push(checked === 1 ? 'Le numéro n’a pas WhatsApp' : `Aucun des ${checked} numéros n’a WhatsApp`);
  if (invalid) parts.push(invalid === 1 ? '1 numéro invalide' : `${invalid} numéros invalides`);
  return parts.join(' ; ');
}

function rowsFor(results, header) {
  const noWhatsapp = results
    .filter((r) => r.status === STATUS.NO_WHATSAPP || r.status === STATUS.NO_NUMBER)
    .map((r) => [r.parent.line, ...r.parent.cells, reason(r), numberDetail(r)]);
  const full = results.map((r) => [
    r.parent.line,
    ...r.parent.cells,
    STATUS_LABEL[r.status],
    r.whatsappNumber ? formatPhone(r.whatsappNumber) : '',
    numberDetail(r),
  ]);
  const unverified = results
    .filter((r) => r.status === STATUS.UNVERIFIED)
    .map((r) => [r.parent.line, ...r.parent.cells, numberDetail(r)]);
  return {
    noWhatsapp: { header: ['Ligne', ...header, 'Raison', 'Détail des numéros'], rows: noWhatsapp },
    full: { header: ['Ligne', ...header, 'Statut WhatsApp', 'Numéro WhatsApp', 'Détail des numéros'], rows: full },
    unverified: { header: ['Ligne', ...header, 'Détail des numéros'], rows: unverified },
  };
}

/** Same format as the input file (Excel "Unicode text" = UTF-16 + tabs), so it opens the same way. */
function writeDelimited(file, { header, rows }, { encoding, delimiter }) {
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const quote = (v) => (delimiter !== '\t' && /["\n;,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header, ...rows].map((row) => row.map((v) => quote(clean(v))).join(delimiter)).join('\r\n') + '\r\n';
  const body = encoding === 'utf16le' || encoding === 'utf16be'
    ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  fs.writeFileSync(file, body);
}

async function writeXlsx(file, sheets) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const { name, header, rows, widths = {} } of sheets) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(header);
    // Every cell is written as text so Excel never turns "+222 …" into a formula
    for (const row of rows) ws.addRow(row.map((v, i) => (i === 0 && typeof v === 'number' ? v : String(v ?? ''))));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
    header.forEach((h, i) => {
      ws.getColumn(i + 1).width = widths[h] || Math.min(60, Math.max(10, h.length + 2));
    });
  }
  await wb.xlsx.writeFile(file);
}

async function writeReports(outDir, results, meta) {
  fs.mkdirSync(outDir, { recursive: true });
  const { noWhatsapp, full, unverified } = rowsFor(results, meta.header);
  const widths = {
    [meta.header[meta.columns.parent]]: 22,
    [meta.header[meta.columns.children]]: 60,
    Raison: 38,
    'Statut WhatsApp': 16,
    'Numéro WhatsApp': 18,
    'Détail des numéros': 70,
  };
  for (const col of meta.columns.phones) widths[meta.header[col]] = 18;

  const files = {
    xlsx: path.join(outDir, 'Parents_sans_WhatsApp.xlsx'),
    noWhatsappCsv: path.join(outDir, 'parents_sans_whatsapp.csv'),
    fullCsv: path.join(outDir, 'rapport_complet.csv'),
    unverifiedCsv: path.join(outDir, 'a_reverifier.csv'),
  };
  const fmt = { encoding: meta.encoding, delimiter: meta.delimiter };
  files.noWhatsappCsv = writeOrAlternate(files.noWhatsappCsv, (f) => writeDelimited(f, noWhatsapp, fmt));
  files.fullCsv = writeOrAlternate(files.fullCsv, (f) => writeDelimited(f, full, fmt));
  if (unverified.rows.length) files.unverifiedCsv = writeOrAlternate(files.unverifiedCsv, (f) => writeDelimited(f, unverified, fmt));
  else {
    fs.rmSync(files.unverifiedCsv, { force: true });
    delete files.unverifiedCsv;
  }

  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = {
    header: ['', 'Nombre'],
    rows: [
      ['Parents dans la liste', results.length],
      ['Ont WhatsApp', count(STATUS.WHATSAPP)],
      ['Pas de WhatsApp (numéros vérifiés)', count(STATUS.NO_WHATSAPP)],
      ['Aucun numéro dans la liste', count(STATUS.NO_NUMBER)],
      ['À revérifier (erreur ou non terminé)', count(STATUS.UNVERIFIED)],
      ['Date de la vérification', new Date().toLocaleString('fr-FR')],
    ],
    widths: { '': 40, Nombre: 22 },
  };
  const sheets = [
    { name: 'Sans WhatsApp', ...noWhatsapp, widths },
    { name: 'Rapport complet', ...full, widths },
    ...(unverified.rows.length ? [{ name: 'À revérifier', ...unverified, widths }] : []),
    { name: 'Résumé', ...summary },
  ];
  try {
    files.xlsx = await writeOrAlternateAsync(files.xlsx, (f) => writeXlsx(f, sheets));
  } catch (err) {
    files.xlsxError = err.message; // the CSV files are still there
    delete files.xlsx;
  }
  return files;
}

const isLocked = (err) => err && (err.code === 'EBUSY' || err.code === 'EPERM');

/** If the file is open in Excel (locked on Windows), write next to it with a timestamp instead. */
function alternateName(file) {
  const ext = path.extname(file);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${file.slice(0, -ext.length)}_${stamp}${ext}`;
}

function writeOrAlternate(file, write) {
  try {
    write(file);
    return file;
  } catch (err) {
    if (!isLocked(err)) throw err;
    const alt = alternateName(file);
    write(alt);
    return alt;
  }
}

async function writeOrAlternateAsync(file, write) {
  try {
    await write(file);
    return file;
  } catch (err) {
    if (!isLocked(err)) throw err;
    const alt = alternateName(file);
    await write(alt);
    return alt;
  }
}

module.exports = { writeReports, rowsFor, reason, numberDetail, STATUS_LABEL, writeDelimited };
