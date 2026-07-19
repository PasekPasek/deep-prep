'use client';

import { useEffect, useState } from 'react';

/**
 * Light/dark toggle. The inline script in layout.tsx applies the stored choice before
 * first paint (no flash); this button just flips the class and persists the choice.
 * System preference is the default until the user chooses explicitly.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-md border px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
    >
      {/* Render both glyphs until mounted so SSR output matches either theme. */}
      {dark === null ? '◐' : dark ? '☀' : '☾'}
    </button>
  );
}

/** Inline `<head>` script — runs before paint, so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
