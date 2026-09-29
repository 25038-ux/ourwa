'use client';
import { marqueClient } from '@/lib/brand-client';

/**
 * EXPORTER EXCEL / PDF — `exporterExcel()`, `exporterCSV()` and
 * `imprimerRapport()`, which El Ourwa repeats across three screens.
 *
 * ⚠ SEMICOLONS, NOT COMMAS, AND A UTF-8 BOM. Both are what make the file open
 * correctly in the Excel this office actually uses: a French locale reads a
 * comma as a decimal separator and would fold every row into one column, and
 * without the leading `﻿` every accent arrives as mojibake. A "CSV export"
 * that produces `MohamedÂ OuldÂ Bilal` in one column is not an export.
 *
 * ⚠ THE ACTION COLUMN IS DROPPED. A column of buttons exports as a column of
 * their labels, which is noise in a spreadsheet.
 *
 * The print view opens the table alone in a new window with its own stylesheet
 * and calls `print()` — El Ourwa labels that button "PDF" because printing to
 * PDF is what the office does with it. Kept, including the label.
 */

/** Its escaping: double the quotes, collapse whitespace, wrap in quotes. */
function cell(text: string): string {
  const flat = text.replace(/(\r\n|\n|\r)/gm, ' ').replace(/\s\s+/g, ' ').trim();
  return `"${flat.replace(/"/g, '""')}"`;
}

function tableToCsv(table: HTMLTableElement, dropLastColumn: boolean): string {
  const lines: string[] = [];
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    const upto = dropLastColumn ? cells.length - 1 : cells.length;
    const out: string[] = [];
    for (let j = 0; j < upto; j += 1) {
      out.push(cell((cells[j] as HTMLElement).innerText ?? ''));
    }
    lines.push(out.join(';'));
  }
  // ⚠ The BOM. Without it Excel reads the file as Latin-1 and every French
  // accent and every Arabic name comes out wrong.
  return `﻿${lines.join('\n')}`;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Blob URLs are held until the document unloads; a page the office leaves
  // open all day would accumulate one per export.
  URL.revokeObjectURL(url);
}

export function ExportButtons({
  tableId,
  filename,
  title,
  dropLastColumn = false,
  print = true,
}: {
  /** The id of the table to export. */
  tableId: string;
  /** Its `liste_groupe_6eme_A.csv` style. */
  filename: string;
  /** Heading for the print view. */
  title: string;
  /** Drop the trailing Action column, as `exporterExcel` does. */
  dropLastColumn?: boolean;
  print?: boolean;
}) {
  const table = () => document.getElementById(tableId) as HTMLTableElement | null;

  const exportCsv = () => {
    const t = table();
    if (!t) return;
    download(filename, tableToCsv(t, dropLastColumn));
  };

  const printReport = () => {
    const t = table();
    if (!t) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const now = new Date();
    const d = now.toLocaleDateString('fr-FR');
    const h = now.toLocaleTimeString('fr-FR');
    win.document.write(
      `<html><head><title>${title} — ${marqueClient()}</title><style>` +
        `body{font-family:'Segoe UI',Tahoma,sans-serif;padding:2rem;color:#1a1a1a}` +
        `h1{font-size:1.4rem;margin-bottom:.5rem}` +
        `h2{font-size:1rem;color:#666;margin-bottom:1.5rem;font-weight:400}` +
        `table{width:100%;border-collapse:collapse;font-size:.85rem}` +
        `th,td{border:1px solid #ddd;padding:.5rem .6rem;text-align:left}` +
        `th{background:#f5f5f5;font-weight:700}` +
        `@media print{body{padding:0}@page{margin:1.5cm}}` +
        `</style></head><body>` +
        `<h1>${marqueClient()} — ${title}</h1>` +
        `<h2>Généré le ${d} à ${h}</h2>` +
        t.outerHTML +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    // Its own delay: printing before the window has laid out gives a blank page.
    setTimeout(() => win.print(), 400);
  };

  return (
    <>
      <button type="button" className="btn btn-sm btn-secondary" onClick={exportCsv}>
        Exporter Excel
      </button>
      {print && (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={printReport}
          style={{ marginLeft: '.4rem' }}
        >
          PDF
        </button>
      )}
    </>
  );
}
