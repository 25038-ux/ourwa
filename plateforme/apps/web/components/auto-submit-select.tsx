'use client';

/** Son `<select onchange="this.form.submit()">` — un îlot client, pour une page serveur. */
export function AutoSubmitSelect({
  id,
  name,
  defaultValue,
  options,
}: {
  id?: string;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
