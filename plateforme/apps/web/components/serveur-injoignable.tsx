'use client';

import { useEffect, useState } from 'react';

/**
 * « LE SERVEUR NE RÉPOND PAS » — À LA PLACE DE LA PAGE, SANS QUITTER LA PAGE
 * (05/10/2026). Un redémarrage de l'API, une coupure d'une minute : la
 * personne restait jusque-là renvoyée à la connexion avec « Votre session a
 * expiré » — faux (ses cookies étaient intacts) et coûteux (l'adresse de la
 * page, le reçu ouvert, perdus). Ici elle reste où elle est ; on demande au
 * site toutes les cinq secondes si l'API est revenue, et la page se recharge
 * d'elle-même quand c'est le cas. Le bouton fait la même chose tout de suite.
 */
export function ServeurInjoignable({ detail }: { detail?: string }) {
  const [essais, setEssais] = useState(0);

  useEffect(() => {
    let fini = false;
    const minuteur = window.setInterval(async () => {
      if (fini) return;
      setEssais((n) => n + 1);
      try {
        const r = await fetch('/api/sante', { cache: 'no-store' });
        const corps = (await r.json()) as { api?: string };
        if (corps.api === 'ok' && !fini) {
          fini = true;
          window.location.reload();
        }
      } catch {
        /* le site lui-même ne répond pas : on réessaie au prochain tour */
      }
    }, 5_000);
    // Pas indéfiniment : au bout de dix minutes, le bouton seul.
    const arret = window.setTimeout(() => window.clearInterval(minuteur), 10 * 60_000);
    return () => {
      fini = true;
      window.clearInterval(minuteur);
      window.clearTimeout(arret);
    };
  }, []);

  return (
    <div className="alert alert-warning" role="alert" style={{ margin: '1rem 0', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <div style={{ flex: '1 1 18rem' }}>
        <strong>Le serveur ne répond pas pour le moment.</strong>{' '}
        Votre session reste ouverte et rien n’a été perdu. La page se rechargera d’elle-même dès qu’il répondra.
        {detail ? <div className="text-muted micro">{detail}</div> : null}
        {essais > 0 ? <div className="text-muted micro">Nouvel essai automatique toutes les 5 secondes…</div> : null}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
        Réessayer maintenant
      </button>
    </div>
  );
}
