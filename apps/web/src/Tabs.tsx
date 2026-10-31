import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { HelpTip } from "./HelpTip";

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  /** One line under the tab bar saying what this tab is for. */
  purpose: string;
  /** Optional longer help for the selected tab, shown as a "?" next to the purpose line. */
  help?: string;
  testId?: string;
}

/**
 * Real tabs (WAI-ARIA tabs pattern): one shared component for the batch record, the TRD and the risk assessment.
 * Arrow keys, Home and End move between tabs and only the selected tab is in the Tab order (roving tabindex).
 * "auto" selects as focus moves (cheap panels); "manual" only moves focus and waits for Enter or Space, which suits tabs that
 * navigate to another route, so a run of arrow presses does not fill the browser history.
 * The tab row wraps on a narrow screen, so the page never scrolls sideways.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  activation = "auto",
  children,
  testId,
}: {
  label: string;
  tabs: TabDef<T>[];
  selected: T;
  onSelect: (id: T) => void;
  activation?: "auto" | "manual";
  children: ReactNode;
  testId?: string;
}) {
  const base = useId().replace(/:/g, "");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  const current = tabs.find((t) => t.id === selected) ?? tabs[0]!;

  const move = (to: number) => {
    const t = tabs[(to + tabs.length) % tabs.length]!;
    refs.current[t.id]?.focus();
    if (activation === "auto") onSelect(t.id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="tabs-wrap stack" data-testid={testId}>
      <div role="tablist" aria-label={label} className="tabs no-print">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={tabId(t.id)}
            className="tab"
            aria-selected={t.id === current.id}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === current.id ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={t.testId}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="tab-purpose small no-print" data-testid="tab-purpose">
        <span>{current.purpose}</span>
        {current.help && <HelpTip label={typeof current.label === "string" ? current.label : "this tab"} text={current.help} />}
      </p>
      <div role="tabpanel" id={panelId(current.id)} aria-labelledby={tabId(current.id)} className="tab-panel stack-lg">
        {children}
      </div>
    </div>
  );
}
