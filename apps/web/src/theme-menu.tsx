import { useEffect, useId, useState } from "react";
import { useDisclosure } from "./disclosure";

// ------------------------------------------------------------------ colour theme

export type Theme = "system" | "light" | "dark";

/** The colour theme, kept in this browser. "System" follows the device setting and stores nothing. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("gap-theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("gap-theme");
      else localStorage.setItem("gap-theme", theme);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [theme]);
  return [theme, setTheme];
}

const THEME_CHOICES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Monitor (system), sun (light) or moon (dark). Decorative: the words are always beside it or in the button's name. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : theme === "dark" ? (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      )}
    </svg>
  );
}

/**
 * The theme button at the right of the header: an icon showing the current choice, opening System / Light / Dark. The choice applies at
 * once and the panel stays open (arrow keys move between the three), so the person sees what each does; Escape or a click elsewhere
 * closes it.
 */
export function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const d = useDisclosure();
  const name = useId();
  const current = THEME_CHOICES.find((c) => c.value === theme)!;
  return (
    <div className="header-menu" ref={d.wrap} onKeyDown={d.onKeyDown} onBlur={d.onBlur}>
      <button ref={d.button} type="button" className="icon-btn" aria-expanded={d.open} aria-controls={d.id} aria-label={`Colour theme: ${current.label}`} onClick={() => d.setOpen((o) => !o)}>
        <ThemeIcon theme={theme} />
      </button>
      <div id={d.id} className="header-popover" hidden={!d.open}>
        {d.open && (
          <fieldset className="theme-options">
            <legend>Colour theme</legend>
            {THEME_CHOICES.map((c) => (
              <label key={c.value} className="theme-option">
                <input type="radio" name={name} value={c.value} checked={theme === c.value} onChange={() => setTheme(c.value)} />
                <ThemeIcon theme={c.value} />
                <span>{c.label}</span>
              </label>
            ))}
            <p className="small muted">System follows the setting of your device.</p>
          </fieldset>
        )}
      </div>
    </div>
  );
}
