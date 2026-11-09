import { useMemo } from "react";
import { ALONGSIDE_STAGES, chainBar, chainStages, type ChainAllowed, type ChainLink, type ChainRoute } from "./chain";
import { useExcipientAllowed, useMbrAllowed, useRiskAllowed, useSamplingAllowed, useTrdAllowed } from "./risk-module";
import { useEffectiveSuggestions } from "./expected-studies-store";
import { href } from "./router";
import { SERVER_MODE } from "./server/mode";
import { useSession } from "./server/session-store";
import { useAssessment, useStore } from "./store";
import { PHONE_WIDTH, useNarrow } from "./viewport";

const to = (l: ChainLink) => href(l.path, l.params);

/** Which modules this account has: the chain leaves out the stages of modules it does not include. */
export function useChainAllowed(): ChainAllowed {
  const trd = useTrdAllowed();
  const sampling = useSamplingAllowed();
  const mbr = useMbrAllowed();
  const risk = useRiskAllowed();
  const excipient = useExcipientAllowed();
  return useMemo(() => ({ trd, sampling, mbr, risk, excipient }), [trd, sampling, mbr, risk, excipient]);
}

/**
 * The document chain as one segmented bar: a segment per stage, "N · name" over a short status. One component for Home and every
 * document page, so they never disagree. The stage on screen is tinted, has a heavy bottom bar and says "(you are here)" (and carries
 * aria-current="step"), so it is never colour alone. The risk assessment sits beside the chain, so it has no number.
 *
 * On a phone the bar would be six cramped cells, so a document page shows one line instead ("Chain 2 of 5 · TRD" and a link to the next
 * stage), and Home, which has no stage on screen, shows the stages stacked. Which form is on screen is decided here, in script, so the
 * page holds only one of them.
 */
export function DocChainStrip({ route, heading = true }: { route?: ChainRoute; heading?: boolean }) {
  const project = useStore((s) => s.project);
  const a = useAssessment();
  const allowed = useChainAllowed();
  const narrow = useNarrow(PHONE_WIDTH);
  // The sampling stage's open-question count reads the account's expected studies list, so the strip follows it.
  const expectedList = useEffectiveSuggestions();
  const stages = useMemo(() => (project ? chainStages(project, a, allowed, route) : []), [project, a, allowed, route, expectedList]);
  if (!project) return null;
  const numbered = stages.filter((s) => !ALONGSIDE_STAGES.includes(s.id));
  const at = numbered.findIndex((s) => s.current);

  // The risk and excipient assessments have no number ("N of 5"), so their page names the stage instead and offers the stage that follows it.
  const riskAt = stages.findIndex((s) => s.current && ALONGSIDE_STAGES.includes(s.id));
  if (narrow && at < 0 && riskAt >= 0) {
    const here = stages[riskAt]!;
    const next = stages.slice(riskAt + 1).find((s) => !ALONGSIDE_STAGES.includes(s.id));
    return (
      <nav aria-label="Document chain" className="doc-chain doc-chain-compact no-print" data-testid="doc-chain">
        <span className="doc-chain-now" aria-current="step" data-testid={`chain-${here.id}`}>
          <span className="doc-chain-label">Chain</span> <strong>{here.name}</strong>
        </span>
        {next && (
          <a className="doc-chain-next" href={to(next)} data-testid="chain-strip-next">
            Next: {next.name} <span aria-hidden="true">›</span>
          </a>
        )}
      </nav>
    );
  }

  if (narrow && at >= 0) {
    const here = numbered[at]!;
    const next = numbered[at + 1];
    return (
      <nav aria-label="Document chain" className="doc-chain doc-chain-compact no-print" data-testid="doc-chain">
        <span className="doc-chain-now" aria-current="step" data-testid={`chain-${here.id}`}>
          <span className="doc-chain-label">Chain</span> <strong>{at + 1} of {numbered.length} · {here.name}</strong>
        </span>
        {next && (
          <a className="doc-chain-next" href={to(next)} data-testid="chain-strip-next">
            Next: {next.name} <span aria-hidden="true">›</span>
          </a>
        )}
      </nav>
    );
  }

  return (
    <nav aria-label="Document chain" className="doc-chain no-print" data-testid="doc-chain">
      {heading && !narrow && (
        <p className="doc-chain-head">
          <strong>Document chain</strong> <span className="muted small">Every stage is optional. Start wherever you have the information.</span>
        </p>
      )}
      <ol className="doc-chain-list">
        {stages.map((s) => {
          const n = numbered.indexOf(s) + 1;
          return (
            <li key={s.id}>
              <a href={to(s)} aria-current={s.current ? "step" : undefined} data-testid={`chain-${s.id}`}>
                <span className="doc-chain-name">
                  {n > 0 ? (
                    <span className="doc-chain-num" aria-hidden="true">
                      {n} ·{" "}
                    </span>
                  ) : (
                    // The risk assessment has no number (it is not a step the next document is built on), so the strip says what it is
                    // instead of leaving a gap that looks like a mistake. The Documents menu lists it under the same word.
                    <span className="doc-chain-num">Alongside: </span>
                  )}
                  {s.name}
                  {s.current && <span className="doc-chain-here"> (you are here)</span>}
                </span>
                <span className="doc-chain-status">{s.status}</span>
              </a>
            </li>
          );
        })}
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
const LIBRARIES: { module: string; id: string; test: (p: string) => boolean; links: { label: string; path: string }[] }[] = [
  { module: "TRD", id: "trd", test: (p) => p === "/trd", links: [{ label: "Process descriptions", path: "/trd/writeups" }] },
  {
    module: "Sampling plan",
    id: "sampling",
    test: (p) => p === "/sampling",
    links: [
      { label: "Sampling tables", path: "/sampling/tables" },
      { label: "Subsection library", path: "/sampling/subsections" },
      { label: "Expected studies", path: "/sampling/expected" },
    ],
  },
  { module: "Batch record", id: "mbr", test: (p) => p === "/mbr", links: [{ label: "Ready-made steps", path: "/mbr/library" }] },
  { module: "Risk assessment", id: "risk", test: (p) => p === "/risk", links: [{ label: "Risk methods", path: "/risk/methods" }] },
  { module: "Excipient assessment", id: "excipient", test: (p) => p === "/excipient", links: [{ label: "Excipient library", path: "/excipient/library" }] },
];

export function ModuleLibraryLinks({ path }: { path: string }) {
  const modules = useSession((s) => s.user?.plan.modules);
  const lib = LIBRARIES.find((l) => l.test(path));
  // A module page that says "not included" must not point into that module's library (the library pages say the same thing).
  if (!lib || (SERVER_MODE && !modules?.includes(lib.id))) return null;
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
