// The light/dark switch. Presentation only: it sets one attribute on <html> and remembers
// the choice. Nothing else on the page reads it.
//
// Three states exist, not two. Until someone chooses, the page follows the operating
// system; choosing pins it. That is why the stored value can be absent, and why the button
// is labelled by what it will do rather than by what is currently on.
//
// The same twenty lines run in the extension side panel. The two are built by different
// toolchains and cannot import from each other; keep them in step.

const KEY = 'bridge-theme';
type Theme = 'light' | 'dark';

/** Storage throws in some privacy modes. A theme is not worth breaking the page over. */
const read = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
};
const write = (t: Theme): void => {
  try { localStorage.setItem(KEY, t); } catch { /* not fatal */ }
};

const systemIsDark = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** What the reader is actually looking at right now. */
const effective = (): Theme => read() ?? (systemIsDark() ? 'dark' : 'light');

/**
 * @param button the toggle
 * @param label  the visually hidden span that gives the button its accessible name
 */
export function initTheme(button: HTMLElement, label: HTMLElement): void {
  const paint = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    // The name says what pressing it does, which is what a screen reader user needs. The
    // icon says the same thing to everyone else, keyed off the same attribute.
    button.dataset.mode = t;
    label.textContent = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  };

  paint(effective());

  button.addEventListener('click', () => {
    const next: Theme = effective() === 'dark' ? 'light' : 'dark';
    write(next);
    paint(next);
  });

  // Someone who has not chosen follows the system, including when it changes under them.
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (read() === null) paint(systemIsDark() ? 'dark' : 'light');
    });
  }
}
