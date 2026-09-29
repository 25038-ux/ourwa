'use client';

/**
 * « Jour à afficher » — le sélecteur de date de `historique.php`, avec son
 * `onchange="this.form.submit()"` et son bouton « Recharger » à côté.
 *
 * ⚠ LES DEUX EXISTENT CHEZ ELLE, ET CE N'EST PAS UNE REDONDANCE : le `onchange`
 * sert la souris, le bouton sert le clavier et les navigateurs où changer une
 * date n'émet pas d'événement avant la perte de focus.
 */
export function JourForm({ jour, tab }: { jour: string; tab: string }) {
  return (
    <form
      method="GET"
      className="form-card"
      style={{ margin: 0, flex: 1, minWidth: 280, padding: '1rem' }}
    >
      <input type="hidden" name="tab" value={tab} />
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="jour">Jour à afficher</label>
          <input
            type="date"
            id="jour"
            name="jour"
            defaultValue={jour}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </div>
        <button className="btn btn-primary" style={{ width: 'auto' }}>
          Recharger
        </button>
      </div>
    </form>
  );
}
