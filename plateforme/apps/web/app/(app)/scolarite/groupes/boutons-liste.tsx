'use client';

/**
 * Les trois boutons de la liste d'une classe — `gestion_groupes.php` :
 * « ← Retour », « Exporter Excel » (son `exporterExcel(tableId, filename)` :
 * une ligne par `<tr>`, la DERNIÈRE colonne — Action — omise, cellules entre
 * guillemets séparées par « ; », BOM UTF-8, `Blob` + `download`) et
 * « Imprimer / PDF » (`window.print()`).
 */
export function BoutonsListe({ nomFichier }: { nomFichier: string }) {
  function exporterExcel() {
    const table = document.getElementById('table_etudiants');
    if (!table) return;
    const csv: string[] = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const row: string[] = [];
      const cols = tr.querySelectorAll('td, th');
      for (let j = 0; j < cols.length - 1; j++) {
        const text = (cols[j]!.textContent ?? '').trim().replace(/"/g, '""');
        row.push('"' + text + '"');
      }
      csv.push(row.join(';'));
    });
    const csvContent = '﻿' + csv.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', nomFichier);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }} className="no-print">
      <a href="/scolarite/groupes" className="btn btn-secondary">← Retour</a>
      <button type="button" onClick={exporterExcel} className="btn btn-success">Exporter Excel</button>
      <button type="button" onClick={() => window.print()} className="btn btn-primary">Imprimer / PDF</button>
    </div>
  );
}
