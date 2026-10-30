import { useMemo } from "react";
import { chainBar, chainStages, type ChainAllowed, type ChainLink, type ChainRoute } from "./chain";
import { useMbrAllowed, useRiskAllowed, useSamplingAllowed, useTrdAllowed } from "./risk-module";
import { href } from "./router";
import { useAssessment, useStore } from "./store";

const to = (l: ChainLink) => href(l.path, l.params);

/** Which modules this account has: the chain leaves out the stages of modules it does not include. */
export function useChainAllowed(): ChainAllowed {
  const trd = useTrdAllowed();
  const sampling = useSamplingAllowed();
  const mbr = useMbrAllowed();
  const risk = useRiskAllowed();
  return useMemo(() => ({ trd, sampling, mbr, risk }), [trd, sampling, mbr, risk]);
}

/**
 * The document chain as a row of links with a short status under each. One component for Home and every document page, so they never
 * disagree. The stage on screen carries aria-current="step" and a heavier outline (not colour alone). On a narrow screen the row
 * scrolls inside itself; the page never does.
 */
export function DocChainStrip({ route, heading = true }: { route?: ChainRoute; heading?: boolean }) {
  const project = useStore((s) => s.project);
  const a = useAssessment();
  const allowed = useChainAllowed();
  const stages = useMemo(() => (project ? chainStages(project, a, allowed, route) : []), [project, a, allowed, route]);
  if (!project) return null;
  return (
    <nav aria-label="Document chain" className="doc-chain no-print" data-testid="doc-chain">
      {heading && (
        <p className="doc-chain-head">
          <strong>Document chain</strong> <span className="muted small">Every stage is optional. Start wherever you have the information.</span>
        </p>
      )}
      <ol className="doc-chain-list">
        {stages.map((s, i) => (
          <li key={s.id}>
            <a href={to(s)} aria-current={s.current ? "step" : undefined} data-testid={`chain-${s.id}`}>
              <span className="doc-chain-name">
                <span className="doc-chain-num" aria-hidden="true">
                  {i + 1}
                </span>
                {s.name}
              </span>
              <span className="doc-chain-status">{s.status}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Back / Next at the foot of a document page, plus any documents already linked to the one on screen. */
export function DocChainBar({ route }: { route: ChainRoute }) {
  const project = useStore((s) => s.project);
  const a = useAssessment();
  const allowed = useChainAllowed();
  const bar = useMemo(() => (project ? chainBar(project, a, allowed, route) : {}), [project, a, allowed, route]);
  if (!bar.back && !bar.next && !bar.nextNote && !bar.related) return null;
  return (
    <nav aria-label="Next document" className="doc-chain-bar no-print" data-testid="doc-chain-bar">
      {bar.related && (
        <p className="small" data-testid="chain-related">
          {bar.related.heading}:{" "}
          {bar.related.links.map((l, i) => (
            <span key={l.label}>
              {i > 0 && ", "}
              <a href={to(l)}>{l.label}</a>
            </span>
          ))}
        </p>
      )}
      <div className="doc-chain-bar-row">
        {bar.back ? (
          <a className="btn" href={to(bar.back)} data-testid="chain-back">
            ◀ {bar.back.label}
          </a>
        ) : (
          <span />
        )}
        {bar.next && (
          <a className="btn primary" href={to(bar.next)} data-testid="chain-next">
            {bar.next.label} ▶
          </a>
        )}
      </div>
      {bar.next && bar.hint && <p className="small muted doc-chain-hint">{bar.hint}</p>}
      {bar.nextNote && <p className="small muted doc-chain-hint">{bar.nextNote}</p>}
    </nav>
  );
}

/** The module libraries, next to the module that uses them (they used to sit in the Library menu, far from their module). */
const LIBRARIES: { module: string; test: (p: string) => boolean; links: { label: string; path: string }[] }[] = [
  { module: "TRD", test: (p) => p === "/trd", links: [{ label: "Process descriptions", path: "/trd/writeups" }] },
  {
    module: "Sampling plan",
    test: (p) => p === "/sampling",
    links: [
      { label: "Sampling tables", path: "/sampling/tables" },
      { label: "Plan subsections", path: "/sampling/subsections" },
    ],
  },
  { module: "Batch record", test: (p) => p === "/mbr", links: [{ label: "Step blocks", path: "/mbr/library" }] },
  { module: "Risk assessment", test: (p) => p === "/risk", links: [{ label: "Risk methods", path: "/risk/methods" }] },
];

export function ModuleLibraryLinks({ path }: { path: string }) {
  const lib = LIBRARIES.find((l) => l.test(path));
  if (!lib) return null;
  return (
    <div className="module-library no-print" role="group" aria-label={`${lib.module} library`} data-testid="module-library">
      <span className="muted small">Library</span>
      {lib.links.map((l) => (
        <a key={l.path} className="btn small" href={href(l.path)}>
          {l.label}
        </a>
      ))}
    </div>
  );
}
