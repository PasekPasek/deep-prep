'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * One dropdown of a filter bar, bound to a URL search param.
 *
 * Filters live in the URL, not in component state: they survive reload, are
 * linkable, and the server component does the filtering. Choosing "all" removes
 * the param entirely so default URLs stay clean.
 */
export function SelectFilter({
  param,
  allLabel,
  options,
}: {
  param: string;
  allLabel: string;
  options: { value: string; label: string; count?: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? '';

  function onChange(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(param, value);
    else next.delete(param);
    router.push(`${pathname}${next.size ? `?${next}` : ''}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      aria-label={allLabel}
      className="h-9 max-w-56 truncate rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
          {option.count !== undefined ? ` · ${option.count}` : ''}
        </option>
      ))}
    </select>
  );
}
