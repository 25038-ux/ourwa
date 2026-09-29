'use client';

/**
 * El Ourwa's `onclick="window.print()"`.
 *
 * A client island so the pages that use it stay server components. The label is
 * passed in because it says two different things there — "Imprimer" and
 * "Enregistrer en PDF" — for the same action, since a school without a printer
 * still needs the file and would not think to look under Print.
 */
export function PrintButton({
  label,
  title,
  className = 'btn btn-primary',
  style,
}: {
  label: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      style={style}
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
