'use client';

import { useEffect, useState } from 'react';
import { genererMotDePasse } from '@elourwa/shared/password';

/**
 * LE CHAMP « MOT DE PASSE » D'UN COMPTE PARENT, DÉJÀ REMPLI (28/09/2026).
 *
 * À l'admission (« Mot de passe initial ») et dans « Reset mdp », l'administrateur
 * tapait le mot de passe. Il arrive maintenant généré (`genererMotDePasse`) :
 * en clair — c'est lui qu'on remet au parent —, modifiable, et ↻ en tire un
 * autre. Le parent doit toujours le changer à la première connexion.
 *
 * Tiré APRÈS le montage (useEffect) et non au rendu : un tirage au rendu
 * différerait entre le serveur et le navigateur (erreur d'hydratation).
 */
export function MotDePasseGenere({ name, placeholder, id }: { name: string; placeholder?: string; id?: string }) {
  const [valeur, setValeur] = useState('');
  useEffect(() => {
    setValeur(genererMotDePasse());
  }, []);

  return (
    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'stretch' }}>
      <input
        type="text"
        id={id}
        name={name}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace', letterSpacing: '.04em' }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        title="Générer un autre mot de passe"
        aria-label="Générer un autre mot de passe"
        onClick={() => setValeur(genererMotDePasse())}
        style={{ flex: '0 0 auto', paddingInline: '.8rem' }}
      >
        ↻
      </button>
    </div>
  );
}
