'use client';

import { useId, useRef, useState } from 'react';
import { acceptPour, libellesPour, MAX_OCTETS_FICHIER, type FamilleFichier } from '@elourwa/shared/fichiers';

/** Its `fmtSize` — French units, one decimal. */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * THE DROP ZONE — `envoyer_exercice.php`.
 *
 * ⚠ IT LISTS WHAT YOU PICKED, WITH SIZES, BEFORE YOU SEND. A teacher attaching a
 * photo of a worksheet from a phone has no idea whether it is 300 Ko or 8 Mo,
 * and finding out from a rejection AFTER the exercise has gone to two hundred
 * families is the wrong moment. Anything over the limit is named in red, with
 * its own words: "— trop volumineux !"
 *
 * ⚠ FIVE FILES, TEN MEGABYTES EACH (five until 04/10/2026 — a phone photo is
 * often more). Both are also the server's, so the preview agrees with what will
 * actually happen. The accepted types are the server's too
 * (`@elourwa/shared/fichiers`): images, PDF and, since 04/10/2026, office
 * documents — a teacher's worksheet is usually a Word file, and the picker used
 * to grey it out.
 *
 * The whole zone is clickable, and it accepts a drop — its terracotta highlight
 * on drag-over, `#c67139` on `#fff2eb`.
 */
export function Dropzone({
  name = 'files',
  familles = ['image', 'pdf', 'bureau'],
  max = 5,
  maxBytes = MAX_OCTETS_FICHIER,
  hint,
  label,
}: {
  name?: string;
  familles?: FamilleFichier[];
  max?: number;
  maxBytes?: number;
  hint?: string;
  label?: string;
}) {
  const accept = acceptPour(familles);
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list).slice(0, max));
  };

  return (
    <div className="form-group">
      <label htmlFor={`${id}-input`}>{label ?? 'Pièces jointes'}</label>

      <div
        id="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (input.current) input.current.files = e.dataTransfer.files;
          take(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${over ? '#c67139' : '#94a3b8'}`,
          borderRadius: 12,
          padding: '1.5rem',
          textAlign: 'center',
          background: over ? '#fff2eb' : '#f8fafc',
          cursor: 'pointer',
          transition: 'all .2s',
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c67139" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '.5rem' }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p style={{ margin: 0, fontWeight: 600, color: '#334155' }}>Glissez-déposez vos fichiers ici</p>
        <p style={{ margin: '.3rem 0 0', fontSize: '.85rem', color: '#64748b' }}>
          ou <span style={{ color: '#c67139', textDecoration: 'underline' }}>parcourez</span> · {hint ?? `${libellesPour(familles)} · ${max > 1 ? `jusqu'à ${max} fichiers, ` : ''}${maxBytes / 1024 / 1024} Mo max chacun`}
        </p>
      </div>

      <input
        ref={input}
        id={`${id}-input`}
        name={name}
        type="file"
        multiple={max > 1}
        accept={accept}
        onChange={(e) => take(e.target.files)}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />

      {files.length > 0 && (
        <div
          id="preview-list"
          style={{ marginTop: '.75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}
          aria-live="polite"
        >
          {files.map((f, i) => {
            const ok = f.size <= maxBytes;
            return (
              <div
                key={`${f.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '.75rem',
                  padding: '.6rem .85rem',
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: '1.5rem' }} aria-hidden="true">
                  {f.type.startsWith('image/') ? '🖼' : '📄'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '.88rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.name}
                  </div>
                  {/* ⚠ Red and named, so the refusal happens here rather than
                      after the exercise has reached two hundred families. */}
                  <div style={{ fontSize: '.75rem', color: ok ? '#64748b' : '#dc2626' }}>
                    {fmtSize(f.size)}
                    {ok ? '' : ' — trop volumineux !'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
