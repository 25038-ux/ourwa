'use client';

/**
 * LA PAGE QUI N'A PAS PU S'AFFICHER — au lieu de « Application error: a
 * server-side exception has occurred », qui dit « le serveur est cassé » et ne
 * propose rien. Cinq pages de finance appelaient l'API sans filet : une API en
 * redémarrage y devenait cet écran. Ici la coquille reste, et on réessaie.
 */
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="alert alert-error" role="alert" style={{ margin: '1rem 0', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <div>
        <strong>Cette page n’a pas pu s’afficher.</strong>{' '}
        Le serveur n’a pas répondu ou a refusé la demande. Rien n’a été perdu.
        {error.digest ? <span className="text-muted micro"> (réf. {error.digest})</span> : null}
      </div>
      <button type="button" className="btn btn-secondary" onClick={reset}>Réessayer</button>
    </div>
  );
}
