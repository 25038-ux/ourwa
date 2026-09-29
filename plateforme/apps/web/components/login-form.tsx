'use client';

import { useEffect, useState } from 'react';

/**
 * Son script « Empêche le double-submit » : à l'envoi, le bouton est
 * désactivé, prend la classe `loading` et dit « Connexion en cours... ».
 * Posé après coup sur le formulaire natif, comme le sien.
 */
export function SubmitGuard() {
  useEffect(() => {
    const f = document.getElementById('form-connexion');
    const b = document.getElementById('btn-connexion') as HTMLButtonElement | null;
    if (!f || !b) return;
    const onSubmit = () => {
      b.disabled = true;
      b.classList.add('loading');
      const span = b.querySelector('span');
      if (span) span.textContent = 'Connexion en cours...';
    };
    f.addEventListener('submit', onSubmit);
    return () => f.removeEventListener('submit', onSubmit);
  }, []);
  return null;
}

/**
 * The password field's show/hide toggle — El Ourwa's `#toggle-mdp`.
 *
 * A client island so the login page itself stays a plain server-rendered form
 * that posts natively (ADR-0011). If the script never loads, the field is still
 * a working password input; only the eye stops working.
 */
export function PasswordField() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="form-group form-group-icon">
      <label htmlFor="mot_de_passe">Mot de passe</label>
      <div className="input-wrapper">
        <svg
          className="input-icon"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          width="18"
          height="18"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
        <input
          type={visible ? 'text' : 'password'}
          id="mot_de_passe"
          name="password"
          placeholder="Votre mot de passe"
          required
          autoComplete="current-password"
        />
        <button
          type="button"
          id="toggle-mdp"
          className="toggle-mdp"
          aria-label="Afficher/masquer le mot de passe"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              width="18"
              height="18"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
              />
            </svg>
          ) : (
            <svg
              id="icon-eye"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              width="18"
              height="18"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
