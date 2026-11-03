/**
 * The product name and the notice wording, written once.
 *
 * The app's notice strip, the Markdown, HTML and Word documents and the tests all import these constants, so the words can never drift
 * apart between the screen and the paper. Change a sentence here and every place that shows it changes with it.
 *
 * GMP reason for the wording: the tool is a drafting aid. What it writes is a draft that the user's own quality system reviews and approves
 * in its own document control; the tool itself is not validated and holds fictional data only. The notice says that on every screen and in
 * every document the tool produces. The tool never decides a filing category, and never says it does.
 */

/** The product name. The "Gap assessment" module, the `@gap/*` package names, the repository and all stored data keep their own names. */
export const PRODUCT_NAME = "Cascade";

/** One line saying what the product is for; shown under the name on the sign-in page and Home, and in the page title. */
export const PRODUCT_SUBTITLE = "GMP transfer documentation";

/** The page title: name and subtitle together. */
export const PRODUCT_TITLE = `${PRODUCT_NAME}: ${PRODUCT_SUBTITLE}`;

/** The notice strip on a desktop-width screen. The app adds the storage phrase ("Data stays in this browser.") after it. */
export const NOTICE_STRIP = "Drafting aid · Not validated · Review and approve every document in your own document control · Fictional data only";

/** The notice strip on a phone: the same three facts, short enough for one line of a narrow screen. */
export const NOTICE_STRIP_PHONE = "Drafting aid · Not validated · Fictional data only";

/** The notice inside every generated document (Markdown, HTML and Word): the banner at the top and the line in the footer. */
export const NOTICE_DOCUMENT = "Drafting aid output, not validated. Review and approve this document in your own document control system. Fictional data only.";

/** The sentence about filing categories, which the page footer adds to the document notice. */
export const FILING_CATEGORY_STATEMENT = "The tool never determines regulatory filing categories.";

/**
 * The page footer of the app: the strip wording in full (the phone strip is short, so the footer is where a phone shows the whole
 * sentence) and the filing-category statement.
 */
export const NOTICE_FOOTER = `${NOTICE_STRIP}. ${FILING_CATEGORY_STATEMENT}`;

/** What the app says about where the data lives, after the strip wording. */
export const STORAGE_PHRASE_BROWSER = "Data stays in this browser.";
export const STORAGE_PHRASE_SERVER = "Your data is kept on the server.";

/**
 * The words for a value nobody knows yet, written once (a first-time tester met four names for one idea: "Not established", "TBD",
 * "unanswered" and "open information items"). The screen, the HTML and the Word documents all use these:
 *  - TBD is the marker for a value that is not known or not decided yet. A cell, a table and a sentence show it instead of an invented
 *    value, so an unknown always stays visible.
 *  - "open items" is the list and the count of everything still to answer or confirm. A TBD is one kind of open item; an answer nobody has
 *    given yet is another. Where both counts sit together the text says how they relate ("38 open items, 1 marked TBD").
 */
export const TBD_MARKER = "TBD";

/** The one-line definition of TBD. Shown once on every page where the marker first appears; the TBD page opens with the same sentence. */
export const TBD_DEFINITION = "A TBD is a value that is not decided yet.";

/**
 * A status column, filter or picker that has to tell "somebody marked this TBD" from "nothing recorded yet" uses this label for the second
 * state. A value cell never does: there both read TBD, because to a reader both mean "not known yet".
 */
export const NO_VALUE_YET = "No value yet";

/** The name of the list/count of everything still to answer or confirm, in the plural. */
export const OPEN_ITEMS_NAME = "open items";

/**
 * "38 open items, 1 marked TBD": how many things are still to answer or confirm, and how many of those somebody marked as TBD on purpose.
 * Both numbers are given because they answer different questions (what is left to do, and what was knowingly postponed); the wording says
 * the second is part of the first so nobody adds them up.
 */
export function openItemsText(open: number, markedTbd: number): string {
  return `${open} open ${open === 1 ? "item" : "items"}, ${markedTbd} marked ${TBD_MARKER}`;
}
