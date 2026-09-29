'use client';

/** Son `<input type="date" onchange="this.form.submit()">`. */
export function DateAutoSubmit({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
