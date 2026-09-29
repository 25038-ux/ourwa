'use client';

import { createContext, useActionState, useContext, useEffect, useRef, useState } from 'react';

export type Message = { type: 'success' | 'error' | 'info'; texte: string } | null;

const Ctx = createContext<(m: Message) => void>(() => {});

/**
 * LE `$message` D'UNE PAGE D'EL OURWA.
 *
 * Chacune de ses pages porte un `$message` / `$type_message` rendu EN HAUT,
 * sous le titre, comme `<div class="alert alert-{type}">` — quel que soit le
 * formulaire qui l'a produit, et jamais à côté du champ. Ce fournisseur tient
 * ce message pour la page ; les formulaires le lui donnent par `useMessagePage()`.
 */
export function MessagePage({ children, initial = null }: { children: React.ReactNode; initial?: Message }) {
  // `initial` : le message porté par l'adresse après une redirection (son `?succes=1`).
  const [message, setMessage] = useState<Message>(initial);
  const ref = useRef<HTMLDivElement>(null);
  // Un message qui arrive se voit : la page remonte dessus, le lecteur d'écran
  // l'annonce, et il se ferme d'un clic.
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [message]);
  return (
    <Ctx.Provider value={setMessage}>
      {message && (
        <div ref={ref} className={`alert alert-${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
          <span style={{ flex: 1 }}>{message.texte}</span>
          <button type="button" className="alert-fermer" aria-label="Fermer le message" onClick={() => setMessage(null)}>×</button>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

/** À appeler avec l'état d'un `useActionState` : `{ ok }`, `{ error }` ou `{ info }`. */
export function useMessagePage(
  state: { ok?: string; error?: string; info?: string } | null | undefined,
) {
  const set = useContext(Ctx);
  useEffect(() => {
    if (!state) return;
    if (state.error) set({ type: 'error', texte: state.error });
    else if (state.info) set({ type: 'info', texte: state.info });
    else if (state.ok) set({ type: 'success', texte: state.ok });
  }, [state, set]);
}

/**
 * Une action dont le résultat monte dans le `$message` de la page AU RETOUR de
 * l'action, pas dans un effet : quand l'action retire la ligne qui la portait
 * (une suppression), le formulaire disparaît avec le rafraîchissement du
 * serveur avant qu'un effet n'ait pu publier, et le message se perdait.
 */
export function useActionMessage<S extends { ok?: string; error?: string; info?: string } | null>(
  fn: (prev: unknown, form: FormData) => Promise<S>,
) {
  const set = useContext(Ctx);
  const enveloppe = async (prev: S | null, form: FormData): Promise<S | null> => {
    const r = await fn(prev, form);
    if (r?.error) set({ type: 'error', texte: r.error });
    else if (r?.info) set({ type: 'info', texte: r.info });
    else if (r?.ok) set({ type: 'success', texte: r.ok });
    return r;
  };
  return useActionState<S | null, FormData>(enveloppe, null);
}
