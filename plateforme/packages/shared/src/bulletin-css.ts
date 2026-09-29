/**
 * LA FEUILLE DU BULLETIN — une seule source, pour ses trois lecteurs : le site
 * du personnel (`/elourwa/bulletin.css` la sert depuis cette constante), le
 * document HTML que l'API rend à l'application des familles, et le PDF que le
 * téléphone en tire. Une divergence visuelle entre « Notes & Bulletins » et le
 * bulletin d'un parent est impossible : c'est le même texte, pas une copie.
 */
export const BULLETIN_CSS = `
/* =============================================================================
   EL OURWA — DOCUMENT « BULLETIN » (feuille PARTAGEE)
   =============================================================================
   Ces regles vivaient dans style.css, que SEULES les pages du personnel
   chargent. Les pages parents ne chargent que parent.css : le bulletin
   imprimable du parent sortait donc avec le bon balisage « bul-* » mais AUCUN
   style — d'ou un document casse.

   Le bulletin est le MEME document des deux cotes : sa mise en page vit
   desormais dans un seul fichier, charge par les deux en-tetes. Une
   divergence visuelle entre « Notes & Bulletins » et le parent devient
   impossible.
   ============================================================================= */

/* =============================================================================
   BULLETIN OFFICIEL BILINGUE FR+AR
   ============================================================================= */
.bulletin-off {
  background: #fff;
  max-width: 960px;
  margin: 0 auto 2rem;
  padding: 1.5rem 2rem;
  border: 2px solid #222;
  font-family: 'Times New Roman', 'Amiri', serif;
  font-size: .85rem;
  color: #111;
}

/* Header tricolonne */
.bul-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1rem;
  padding-bottom: .75rem;
  border-bottom: 3px double #333;
  margin-bottom: .75rem;
  align-items: start;
}
.bul-hcol-fr { text-align: left; }
.bul-hcol-center { text-align: center; }
.bul-hcol-ar { text-align: right; }
.bul-republic { font-weight: 700; font-size: .82rem; margin: 0 0 .15rem; }
.bul-honor { font-size: .72rem; color: #444; margin: 0 0 .15rem; font-style: italic; }
.bul-ministry { font-size: .72rem; color: #333; margin: 0; font-weight: 600; }
.bul-logo-wrap { display: flex; flex-direction: column; align-items: center; gap: .2rem; }
.bul-logo-name { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: .95rem; color: #1a6b3c; }

/* Bande titre */
.bul-title-band {
  background: #1a3a5c;
  color: #fff;
  text-align: center;
  padding: .5rem 1rem;
  margin-bottom: .75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.bul-title-fr { font-size: 1rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
.bul-title-ar { font-size: 1rem; font-weight: 700; }
.bul-title-sep { opacity: .5; }

/* Info étudiant */
.bul-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .25rem .5rem;
  padding: .5rem .75rem;
  border: 1px solid #ccc;
  margin-bottom: .75rem;
  background: #fafafa;
}
.bul-info-row {
  display: flex;
  align-items: baseline;
  gap: .4rem;
  padding: .1rem 0;
  border-bottom: 1px dotted #e0e0e0;
  font-size: .8rem;
}
.bul-lbl-fr { color: #555; min-width: 90px; white-space: nowrap; }
.bul-lbl-ar { color: #555; min-width: 80px; }
.bul-sep { color: #bbb; }
.bul-val { font-weight: 600; }

/* Tableau des notes */
.bul-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: .75rem;
  font-size: .8rem;
}
.bul-table th, .bul-table td {
  border: 1px solid #aaa;
  padding: .3rem .5rem;
  text-align: center;
  vertical-align: middle;
}
.bul-thead-ar { background: #1a3a5c; color: #fff; font-size: .72rem; }
.bul-thead-fr { background: #e8f0fe; color: #222; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
.bul-thead-ar th, .bul-thead-fr th { border-color: #888; }
.bul-td-subject { text-align: left; font-weight: 600; padding-left: .75rem !important; }
.bul-td-moy { font-weight: 800; font-size: .9rem; }
.bul-td-total { font-weight: 700; }
.bul-row-odd { background: #fff; }
.bul-row-even { background: #f8f8f8; }
.bul-pass { color: #059669 !important; }
.bul-fail { color: #DC2626 !important; }
.bul-tfoot td { background: #f0f0f0; font-weight: 700; border: 1px solid #888; padding: .4rem .5rem; }
.bul-tfoot-label { text-align: right; padding-right: .75rem !important; font-size: .75rem; }
.bul-tfoot-avg { font-size: 1.05rem; background: #1a3a5c !important; color: #fff !important; }

/* Pied de page */
.bul-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  margin-top: .75rem;
  padding-top: .75rem;
  border-top: 2px solid #333;
}
.bul-foot-col { font-size: .78rem; }
.bul-foot-title { font-weight: 700; font-size: .75rem; text-transform: uppercase; letter-spacing: .5px; color: #333; margin-bottom: .5rem; border-bottom: 1px solid #ccc; padding-bottom: .2rem; }
.bul-foot-center { text-align: center; }
.bul-result-row { display: flex; gap: .5rem; margin-bottom: .2rem; align-items: baseline; flex-wrap: wrap; }
.bul-sig-area { height: 55px; border-bottom: 1px solid #555; margin: .4rem .5rem; }
.bul-obs-area { height: 40px; border-bottom: 1px solid #ccc; margin: .4rem 0; }

/* Warning */
.bul-warning {
  background: #1a3a5c;
  color: #fff;
  text-align: center;
  padding: .35rem .75rem;
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .3px;
  margin-top: .75rem;
}


`;
