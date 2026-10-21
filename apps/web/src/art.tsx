import type { ReactNode } from "react";

/**
 * Website art. The pictures are AI-generated, fictional and carry no text or brands (see the README). They live in
 * `public/art/` as two webp widths each and are NOT imported into the JS bundle, so they never slow the app down: the browser
 * fetches only the ones on screen (lazy) and picks the width from the srcset.
 *
 * Every picture is decoration: alt="" and aria-hidden, no information is carried only by an image, and no text is baked in.
 */

/** Relative base ("./"): works on GitHub Pages under /gap-assessment/ and on the laptop server alike. */
const BASE = import.meta.env.BASE_URL;
/** Pixel size of the files, used for width/height so the browser reserves the space before the picture arrives. */
const W = 1600;
const H = 893;

/**
 * People who ask their browser to save data get no pictures at all (the layout is made to look right without them).
 * `prefers-reduced-data` has no CSS-only way to stop a download, so it is checked here once.
 */
const REDUCED_DATA = (() => {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-data: reduce)").matches;
  } catch {
    return false;
  }
})();

function ArtImg({ name, sizes, eager }: { name: string; sizes: string; eager?: boolean }) {
  if (REDUCED_DATA) return null;
  return (
    <img
      src={`${BASE}art/${name}-1600.webp`}
      srcSet={`${BASE}art/${name}-800.webp 800w, ${BASE}art/${name}-1600.webp 1600w`}
      sizes={sizes}
      width={W}
      height={H}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      {...(eager ? { fetchPriority: "high" as const } : {})}
    />
  );
}

/**
 * A calm banner at the top of a page. The pictures were composed with empty space on the left third, where the title sits on a
 * gradient scrim (see .art-banner in styles.css) so the text keeps AA contrast in light and dark. `children` is the page's own
 * heading (kept as the real h1 so focus handling and tests are unchanged); `label` is for pages whose h1 is elsewhere
 * (the interview's h1 is the question), shown as plain text.
 */
export function PageBanner({
  art,
  children,
  label,
  size = "normal",
}: {
  art: string;
  children?: ReactNode;
  label?: string;
  size?: "normal" | "hero" | "slim";
}) {
  return (
    <div className={`art-banner art-${size}`} data-art={art}>
      <div className="art-banner-img" aria-hidden="true">
        <ArtImg name={art} sizes="(min-width: 1312px) 1280px, 100vw" eager={size === "hero"} />
      </div>
      <div className="art-banner-body">{label ? <p className="art-banner-title">{label}</p> : children}</div>
    </div>
  );
}

/** A small decorative figure (unit-operation picture or close-up). `sizes` follows the CSS width of the figure. */
export function ArtFigure({ art, className, sizes }: { art: string; className: string; sizes: string }) {
  return (
    <figure className={`art-fig ${className}`} data-art={art} aria-hidden="true">
      <ArtImg name={art} sizes={sizes} />
    </figure>
  );
}

/** Unit-operation section id -> picture. Stoppering and lyophilization share one picture (the freeze-dryer loading the partly stoppered vials). */
const SECTION_ART: Record<string, string> = {
  "uo.ds_receipt_thaw": "uo-ds-receipt-thaw",
  "uo.buffer_prep": "uo-buffer-prep",
  "uo.compounding": "uo-compounding",
  "uo.bbr_filtration": "uo-bbr-filtration",
  "uo.sterile_filtration": "uo-sterile-filtration",
  "uo.aseptic_filling": "uo-aseptic-filling",
  "uo.stoppering": "uo-stoppering-lyo",
  "uo.lyophilization": "uo-stoppering-lyo",
  "uo.capping": "uo-capping",
  "uo.visual_inspection": "uo-visual-inspection",
  "uo.labeling_packaging": "uo-labeling-packaging",
  "uo.storage_shipping": "uo-storage-shipping",
};

export function sectionArt(sectionId: string): string | undefined {
  return SECTION_ART[sectionId];
}

/**
 * Close-ups sit beside a question only where the match is obvious (the picture shows the thing the question asks about).
 * Anything else, including custom questions, gets no close-up: a loosely related picture would mislead more than it helps.
 */
const CLOSEUPS: { art: string; ids: RegExp }[] = [
  { art: "uo-pupsit", ids: /^filt\.pupsit/ },
  { art: "uo-filtration-assembly", ids: /^filt\.(redundant|sua)/ },
  { art: "uo-filter-housing", ids: /^(bbr|filt)\.(membrane|pore|supplier|part|area|sizing)$/ },
  { art: "uo-buffer-thaw", ids: /^buf\.(route|thaw_)/ },
  { art: "uo-dilution", ids: /^(scope\.dilution|comp\.(diluent|diluent_volume|target_conc))$/ },
  { art: "uo-mixing-bag", ids: /^(comp|buf)\.vessel_(type|capacity)$/ },
  { art: "uo-mixing-bag-closeup", ids: /^(comp\.(mixing_coverage|mixing_demonstrated)|buf\.mixing|rt\.mixing)$/ },
  { art: "uo-mixing-tank", ids: /^(comp|buf)\.mixer|^(comp|buf)\.mixing_(speed|time)$/ },
  // There is no bulk-packaging unit operation; the closest is labeling and packaging, and the pack configuration is the question it fits.
  { art: "uo-bulk-packaging", ids: /^lp\.pack_config$/ },
];

export function closeupArt(questionId: string): string | undefined {
  return CLOSEUPS.find((c) => c.ids.test(questionId))?.art;
}
