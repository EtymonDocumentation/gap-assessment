import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@gap/engine";

/**
 * The Cascade mark: three bars stepping down and to the right, each a little lighter than the one before (the documents lead into each
 * other, none is required). Drawn with the current text colour so one component serves the dark header bar and any light surface; the
 * favicon (public/favicon.svg) is the same drawing. Decorative: the name "Cascade" always sits beside it.
 */
export function CascadeMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="cascade-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="12" height="6" rx="2" fill="currentColor" />
      <rect x="10" y="13" width="12" height="6" rx="2" fill="currentColor" opacity="0.75" />
      <rect x="17" y="22" width="12" height="6" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** "Cascade · GMP transfer documentation": the name and what the product is for, above the title of the sign-in page and Home. */
export function ProductEyebrow() {
  return (
    <p className="eyebrow">
      {PRODUCT_NAME} · {PRODUCT_SUBTITLE}
    </p>
  );
}
