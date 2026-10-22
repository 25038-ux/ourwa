'use strict';

const fs = require('fs');

const DEFAULT_COUNTRY_CODE = '222'; // Mauritania

/**
 * Decode a text file whatever the way Excel saved it:
 * UTF-16 LE/BE ("Unicode text"), UTF-8 (with or without BOM) or Windows-1252.
 */
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf16be' };
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

function detectDelimiter(headerLine) {
  const counts = ['\t', ';', ','].map((d) => [d, headerLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : '\t';
}

/** RFC 4180-style parser (quotes, escaped quotes, newlines inside quotes). */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Turn one raw phone string into international digits (no "+").
 * Returns { digits, valid, reason }.
 */
function normalizePhone(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  const s = String(raw).trim();
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('00')) digits = digits.slice(2);
  else if (!s.startsWith('+') && digits.length === 8) digits = countryCode + digits;

  if (digits.startsWith('222')) {
    // Mauritanian numbers are always 222 + 8 digits
    if (digits.length !== 11) return { digits, valid: false, reason: 'longueur incorrecte pour +222' };
    return { digits, valid: true };
  }
  if (digits.length < 10 || digits.length > 15) return { digits, valid: false, reason: 'format inconnu' };
  return { digits, valid: true };
}

/** Pull every phone number out of one cell ("+222 22 22 42 21", "A / B", "AUCUN NUMÉRO"...). */
function extractPhones(cell, countryCode) {
  if (!cell) return [];
  return String(cell)
    .split(/[\/;,|\n]+|\s+(?:et|ou|and|or)\s+/i)
    .map((piece) => piece.trim())
    .filter((piece) => (piece.match(/\d/g) || []).length >= 6)
    .map((piece) => ({ raw: piece, ...normalizePhone(piece, countryCode) }));
}

function findColumns(header) {
  const norm = header.map((h) =>
    h
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim(),
  );
  let parent = norm.findIndex((h) => /parent|tuteur|nom/.test(h));
  let children = norm.findIndex((h) => /enfant|eleve|child/.test(h));
  let phones = norm
    .map((h, i) => (/tel|phone|mobile|gsm|whatsapp|numero/.test(h) ? i : -1))
    .filter((i) => i >= 0 && i !== parent && i !== children);
  if (parent < 0) parent = 0;
  if (children < 0) children = 1;
  if (!phones.length) phones = header.map((_, i) => i).filter((i) => i !== parent && i !== children);
  return { parent, children, phones };
}

/**
 * Read the parents file and return
 * { parents: [{ line, name, children, cells, phones }], header, columns, encoding, delimiter }.
 */
function loadParents(filePath, { countryCode = DEFAULT_COUNTRY_CODE } = {}) {
  const { text, encoding } = decodeText(fs.readFileSync(filePath));
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = detectDelimiter(firstLine);
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) throw new Error(`No data rows found in ${filePath}`);

  const header = rows[0].map((h) => h.trim());
  const columns = findColumns(header);
  const parents = rows.slice(1).map((cells, idx) => {
    const seen = new Set();
    const phones = [];
    for (const col of columns.phones) {
      for (const p of extractPhones(cells[col], countryCode)) {
        if (seen.has(p.digits)) continue;
        seen.add(p.digits);
        phones.push(p);
      }
    }
    return {
      line: idx + 2, // line number as seen in Excel (header is line 1)
      name: (cells[columns.parent] || '').trim(),
      children: (cells[columns.children] || '').trim(),
      cells: header.map((_, i) => (cells[i] || '').trim()),
      phones,
    };
  });
  return { parents, header, columns, encoding, delimiter };
}

/** Short human label: parent names are often just "P", so show the children too. */
function parentLabel(parent, max = 70) {
  const kids = parent.children
    .split('/')
    .map((k) => k.replace(/—/g, '').trim())
    .filter(Boolean)
    .join(', ');
  const label = `${parent.name || '?'} (${kids || 'sans enfant'})`;
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function formatPhone(digits) {
  if (digits.startsWith('222') && digits.length === 11) {
    const n = digits.slice(3);
    return `+222 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)}`;
  }
  return `+${digits}`;
}

module.exports = {
  decodeText,
  detectDelimiter,
  parseDelimited,
  normalizePhone,
  extractPhones,
  findColumns,
  loadParents,
  parentLabel,
  formatPhone,
};
