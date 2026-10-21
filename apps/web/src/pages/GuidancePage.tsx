import { guidance } from "@gap/content";
import {
  filterGuidance,
  groupGuidance,
  guidanceAgencies,
  GUIDANCE_JURISDICTIONS,
  GUIDANCE_JURISDICTION_LABELS,
  GUIDANCE_LANGUAGE_LABELS,
  GUIDANCE_STATUSES,
  GUIDANCE_STATUS_LABELS,
  GUIDANCE_TOPICS,
  GUIDANCE_TOPIC_LABELS,
  GUIDANCE_TYPES,
  GUIDANCE_TYPE_LABELS,
  needsConfirmation,
  type GuidanceFilter,
  type GuidanceItem,
} from "@gap/engine";
import { useMemo, useState } from "react";
import { Empty } from "../components";

const NO_FILTER: Required<GuidanceFilter> = { text: "", jurisdiction: "all", agency: "all", topic: "all", type: "all", status: "all" };

/** A link to an official page. It always opens in a new tab so the person keeps their place in the assessment. */
function OfficialLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in new tab)</span>
    </a>
  );
}

function GuidanceEntry({ item }: { item: GuidanceItem }) {
  const confirm = needsConfirmation(item);
  const language = item.language !== "en" ? (GUIDANCE_LANGUAGE_LABELS[item.language] ?? item.language) : "";
  return (
    <li className="guide-item">
      <h3 className="guide-title">
        <OfficialLink href={item.url}>{item.title}</OfficialLink>
      </h3>
      <p className="small guide-meta">
        <span>Reference: {item.reference}</span>
        <span>Agency: {item.agency}</span>
        <span>Type: {GUIDANCE_TYPE_LABELS[item.type]}</span>
        <span>Status: {GUIDANCE_STATUS_LABELS[item.status]}</span>
        <span>Date: {item.date || "not captured"}</span>
        {language && <span>Language: {language}</span>}
        {item.access === "subscription" && <span>Subscription needed</span>}
      </p>
      {(confirm || item.verified === "blocked-but-official" || item.pdf) && (
        <p className="small guide-flags">
          {confirm && <span className="guide-badge">Details to confirm</span>}
          {item.verified === "blocked-but-official" && <span className="muted">Official site; blocks automated checks</span>}
          {item.pdf && (
            <OfficialLink href={item.pdf}>
              Direct PDF
            </OfficialLink>
          )}
        </p>
      )}
      {item.notes && <p className="small muted guide-notes">{item.notes}</p>}
    </li>
  );
}

/**
 * The Guidance library: one place to click straight through to the official text of regulations and guidance.
 * Reference only. It needs no open project and makes no network calls itself (the links are plain anchors), so it works
 * the same in the static build and in server mode.
 */
export function GuidancePage() {
  const [f, setF] = useState<Required<GuidanceFilter>>(NO_FILTER);
  const items = guidance.items;
  const shown = useMemo(() => filterGuidance(items, f), [items, f]);
  const groups = useMemo(() => groupGuidance(shown), [shown]);
  const agencies = useMemo(() => guidanceAgencies(items), [items]);
  const set = (k: keyof GuidanceFilter) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  // Offer only values that occur in the list, in the fixed display order.
  const present = <T extends string>(all: readonly T[], pick: (i: GuidanceItem) => string | readonly string[]) =>
    all.filter((v) => items.some((i) => [pick(i)].flat().includes(v)));

  return (
    <div className="stack-lg">
      <div>
        <h1>Guidance</h1>
        <p className="muted lede">
          Official regulations and guidance for sterile injectable fill-finish, technology transfer and post-approval changes, from regulators and
          pharmacopoeias around the world. Use it to read the source text behind a gap.
        </p>
        <p className="notice">
          Links open the official agency site. Always confirm you are reading the current version there.
          <span className="guide-checked"> Last checked: {guidance.checked}.</span>
        </p>
      </div>

      <div className="filters guide-filters" role="search" aria-label="Search and filter the guidance">
        <label className="field guide-search">
          <span>Search</span>
          <input type="search" value={f.text} onChange={set("text")} placeholder="Title, reference, agency or notes, e.g. Annex 1" />
        </label>
        <label className="field">
          <span>Jurisdiction or market</span>
          <select value={f.jurisdiction} onChange={set("jurisdiction")}>
            <option value="all">All</option>
            {present(GUIDANCE_JURISDICTIONS, (i) => i.jurisdiction).map((j) => (
              <option key={j} value={j}>
                {GUIDANCE_JURISDICTION_LABELS[j]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Agency</span>
          <select value={f.agency} onChange={set("agency")}>
            <option value="all">All</option>
            {agencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Topic</span>
          <select value={f.topic} onChange={set("topic")}>
            <option value="all">All</option>
            {present(GUIDANCE_TOPICS, (i) => i.topics).map((t) => (
              <option key={t} value={t}>
                {GUIDANCE_TOPIC_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={f.type} onChange={set("type")}>
            <option value="all">All</option>
            {present(GUIDANCE_TYPES, (i) => i.type).map((t) => (
              <option key={t} value={t}>
                {GUIDANCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={f.status} onChange={set("status")}>
            <option value="all">All</option>
            {present(GUIDANCE_STATUSES, (i) => i.status).map((s) => (
              <option key={s} value={s}>
                {GUIDANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => setF(NO_FILTER)}>
          Clear filters
        </button>
      </div>

      <p className="small muted filter-count" role="status" aria-live="polite">
        {shown.length} of {items.length} shown
      </p>

      {groups.length === 0 ? (
        <Empty>Nothing matches. Clear a filter or shorten the search.</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.jurisdiction} aria-labelledby={`guide-${g.jurisdiction}`}>
            <h2 id={`guide-${g.jurisdiction}`}>
              {g.label} <span className="muted small">({g.items.length})</span>
            </h2>
            <ul className="guide-list">
              {g.items.map((it) => (
                <GuidanceEntry key={it.id} item={it} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
