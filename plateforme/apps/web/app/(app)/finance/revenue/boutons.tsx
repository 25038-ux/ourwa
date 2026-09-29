'use client';
import { marqueClient } from '@/lib/brand-client';

/** Son `<input type="date" name="jour" onchange="this.form.submit()">`. */
export function JourInput({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}

/**
 * Son `imprimerRapport(tableId, titre)` — `revenue_live.php`, tel quel : une
 * fenêtre neuve avec le tableau seul, son titre, l'heure de génération, et
 * l'impression lancée 400 ms plus tard.
 */
export function ImprimerRapport({ tableId, titre }: { tableId: string; titre: string }) {
  function imprimer() {
    const table = document.getElementById(tableId);
    if (!table) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
        <html><head><title>${titre} — ${marqueClient()}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 2rem; color: #1a1a1a; }
            h1 { font-size: 1.4rem; margin-bottom: .5rem; }
            h2 { font-size: 1rem; color: #666; margin-bottom: 1.5rem; font-weight: 400; }
            table { width: 100%; border-collapse: collapse; font-size: .85rem; }
            th, td { border: 1px solid #ddd; padding: .5rem .6rem; text-align: left; }
            th { background: #f5f5f5; font-weight: 700; }
            @media print {
                body { padding: 0; }
                @page { margin: 1.5cm; }
            }
        </style></head><body>
        <h1>${marqueClient()} — ${titre}</h1>
        <h2>Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</h2>
        ${table.outerHTML}
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 400);
  }
  return (
    <button type="button" className="btn btn-sm btn-secondary" onClick={imprimer}>
      PDF
    </button>
  );
}
