'use client';

import { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServeurInjoignable } from '@/components/serveur-injoignable';

/**
 * LA PAGE QUI N'A PAS PU S'AFFICHER — au lieu de « Application error: a
 * server-side exception has occurred », qui dit « le serveur est cassé » et ne
 * propose rien. Cinq pages de finance appelaient l'API sans filet : une API en
 * redémarrage y devenait cet écran. Ici la coquille reste, et on réessaie.
 *
 * ⚠ LE MESSAGE D'UNE ERREUR SERVEUR EST MASQUÉ EN PRODUCTION : on ne peut pas
 * y lire « injoignable ». On DEMANDE donc au site si l'API répond
 * (`/api/sante`) : si non, « le serveur ne répond pas » et la page revient
 * d'elle-même ; si oui, c'est la page qui a échoué, et « Réessayer » la
 * redemande.
 *
 * ⚠ « RÉESSAYER » NE FAISAIT RIEN (05/10/2026). `reset()` seul ré-affiche le
 * segment avec la réponse déjà reçue — l'erreur — sans redemander la page au
 * serveur : le bouton semblait mort. `router.refresh()` la redemande.
 */
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [api, setApi] = useState<'?' | 'ok' | 'injoignable'>('?');

  useEffect(() => {
    let vivant = true;
    fetch('/api/sante', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ api?: string }>)
      .then((c) => vivant && setApi(c.api === 'ok' ? 'ok' : 'injoignable'))
      .catch(() => vivant && setApi('injoignable'));
    return () => {
      vivant = false;
    };
  }, [error]);

  if (api === 'injoignable') return <ServeurInjoignable />;

  return (
    <div className="alert alert-error" role="alert" style={{ margin: '1rem 0', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <div>
        <strong>Cette page n’a pas pu s’afficher.</strong>{' '}
        Le serveur n’a pas répondu ou a refusé la demande. Rien n’a été perdu.
        {error.digest ? <span className="text-muted micro"> (réf. {error.digest})</span> : null}
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        Réessayer
      </button>
    </div>
  );
}
