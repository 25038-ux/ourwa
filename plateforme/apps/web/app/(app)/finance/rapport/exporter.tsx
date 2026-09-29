'use client';

/**
 * Son `exporterCSV(tableId, filename)` — `rapport_financier.php`, tel quel :
 * une ligne par `<tr>`, les cellules entre guillemets, séparées par « ; »,
 * le BOM UTF-8 en tête pour Excel.
 */
export function ExporterCsv({
  tableId,
  filename,
  petit = false,
}: {
  tableId: string;
  filename: string;
  /** `btn-sm`, comme sur Revenue Live. */
  petit?: boolean;
}) {
  function exporter() {
    const table = document.getElementById(tableId);
    if (!table) return;
    const csv: string[] = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const row: string[] = [];
      tr.querySelectorAll('td, th').forEach((cell) => {
        let text = (cell as HTMLElement).innerText
          .replace(/(\r\n|\n|\r)/gm, ' ')
          .replace(/(\s\s+)/g, ' ')
          .trim();
        text = text.replace(/"/g, '""');
        row.push('"' + text + '"');
      });
      csv.push(row.join(';'));
    });
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + csv.join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  return (
    <button
      type="button"
      className={petit ? 'btn btn-sm btn-secondary' : 'btn btn-secondary'}
      onClick={exporter}
    >
      Exporter Excel
    </button>
  );
}
