/**
 * "Contents" at the top of the long sampling plan page: one link per section. The page is a hash-routed app, so a plain `#id` link
 * would change the route; these are buttons that scroll to the section and move focus to its heading. A section that lives on
 * another tab of the page first switches to that tab.
 */
export type ContentsTab = "overview" | "interview" | "subsections";

interface Item {
  id: string;
  label: string;
  tab?: ContentsTab;
}

// Always on the page, in page order.
const ALWAYS: Item[] = [
  { id: "sp-details", label: "Plan details" },
  { id: "sp-steps-h", label: "Process steps" },
  { id: "sp-figdata-h", label: "Flow figure details" },
  { id: "sp-batches", label: "PPQ batches" },
  { id: "sp-design", label: "PPQ design and readiness" },
];
const BY_TAB: Record<ContentsTab, Item[]> = {
  overview: [
    { id: "sp-open", label: "Open items", tab: "overview" },
    { id: "sp-sugg", label: "Suggestions", tab: "overview" },
    { id: "sp-flow", label: "Process flow diagram", tab: "overview" },
    { id: "sp-figure-h", label: "PPQ flow figure", tab: "overview" },
    { id: "sp-points", label: "Sampling points", tab: "overview" },
    { id: "sp-totals", label: "Sample totals per batch", tab: "overview" },
    { id: "sampling-doc", label: "Sampling plan document", tab: "overview" },
  ],
  interview: [
    { id: "sp-parties", label: "Who does what", tab: "interview" },
    { id: "sp-interview", label: "Sampling interview", tab: "interview" },
    { id: "sp-agency", label: "Agency requests", tab: "interview" },
  ],
  subsections: [],
};

export function SamplingContents({ tab, onTab }: { tab: ContentsTab; onTab: (t: ContentsTab) => void }) {
  const go = (it: Item) => {
    if (it.tab && it.tab !== tab) onTab(it.tab);
    // The other tab renders on the next frame; look for the heading after it has.
    window.setTimeout(() => {
      const el = document.getElementById(it.id);
      if (!el) return;
      el.setAttribute("tabindex", "-1");
      el.scrollIntoView({ block: "start" });
      el.focus({ preventScroll: true });
    }, it.tab && it.tab !== tab ? 60 : 0);
  };
  const groups: { title: string; items: Item[]; tab?: ContentsTab }[] = [
    { title: "Plan set-up", items: ALWAYS },
    { title: "Overview tab", items: BY_TAB.overview, tab: "overview" },
    { title: "Interview tab", items: BY_TAB.interview, tab: "interview" },
  ];
  return (
    <nav className="card stack no-print" aria-labelledby="sp-contents" data-testid="plan-contents">
      <h2 id="sp-contents">Contents</h2>
      <p className="small muted">Jump to a section of this plan. Sections on another tab open that tab first.</p>
      <div className="contents-groups">
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="small">{g.title}</h3>
            <ul className="contents-list small">
              {g.items.map((it) => (
                <li key={it.id}>
                  <button type="button" className="link-btn" onClick={() => go(it)} data-testid={`contents-${it.id}`}>
                    {it.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
