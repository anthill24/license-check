/**
 * Bundled SPDX license → category map and a pragmatic SPDX expression
 * evaluator.
 *
 * This map is intentionally small and opinionated. It covers the licenses most
 * commonly seen in the npm ecosystem. It is NOT exhaustive and is NOT legal
 * advice — categories are a triage aid only. Unrecognised identifiers fall
 * through to the `unknown` category.
 *
 * Identifiers use canonical SPDX short identifiers
 * (https://spdx.org/licenses/). Some historical/deprecated ids that still
 * appear in `package.json` files (e.g. `GPL-3.0`, `Apache 2.0`) are normalised
 * in {@link normalizeLicenseId} before lookup.
 */
import type { LicenseCategory } from "./types.js";

/**
 * Static map of SPDX id → category. Kept deliberately readable and grouped so
 * contributors can audit and extend it.
 */
export const SPDX_CATEGORIES: Readonly<Record<string, LicenseCategory>> = {
  // ---- Permissive ---------------------------------------------------------
  "0BSD": "permissive",
  "AFL-3.0": "permissive",
  "Apache-1.1": "permissive",
  "Apache-2.0": "permissive",
  "Artistic-2.0": "permissive",
  "BlueOak-1.0.0": "permissive",
  "BSD-2-Clause": "permissive",
  "BSD-2-Clause-Patent": "permissive",
  "BSD-3-Clause": "permissive",
  "BSD-3-Clause-Clear": "permissive",
  "BSD-Source-Code": "permissive",
  "BSL-1.0": "permissive",
  "CC0-1.0": "permissive",
  "CC-BY-3.0": "permissive",
  "CC-BY-4.0": "permissive",
  "ISC": "permissive",
  "MIT": "permissive",
  "MIT-0": "permissive",
  "MS-PL": "permissive",
  "NCSA": "permissive",
  "OpenSSL": "permissive",
  "PHP-3.01": "permissive",
  "PostgreSQL": "permissive",
  "Python-2.0": "permissive",
  "Unicode-DFS-2016": "permissive",
  "Unlicense": "permissive",
  "UPL-1.0": "permissive",
  "WTFPL": "permissive",
  "X11": "permissive",
  "Zlib": "permissive",

  // ---- Weak / file-level copyleft ----------------------------------------
  "CDDL-1.0": "weak-copyleft",
  "CDDL-1.1": "weak-copyleft",
  "CPL-1.0": "weak-copyleft",
  "EPL-1.0": "weak-copyleft",
  "EPL-2.0": "weak-copyleft",
  "LGPL-2.0-only": "weak-copyleft",
  "LGPL-2.0-or-later": "weak-copyleft",
  "LGPL-2.1-only": "weak-copyleft",
  "LGPL-2.1-or-later": "weak-copyleft",
  "LGPL-3.0-only": "weak-copyleft",
  "LGPL-3.0-or-later": "weak-copyleft",
  "MPL-1.1": "weak-copyleft",
  "MPL-2.0": "weak-copyleft",
  "MS-RL": "weak-copyleft",

  // ---- Strong / project-level copyleft -----------------------------------
  "GPL-1.0-only": "strong-copyleft",
  "GPL-1.0-or-later": "strong-copyleft",
  "GPL-2.0-only": "strong-copyleft",
  "GPL-2.0-or-later": "strong-copyleft",
  "GPL-3.0-only": "strong-copyleft",
  "GPL-3.0-or-later": "strong-copyleft",
  "OSL-3.0": "strong-copyleft",
  "EUPL-1.1": "strong-copyleft",
  "EUPL-1.2": "strong-copyleft",

  // ---- Network copyleft ---------------------------------------------------
  "AGPL-1.0-only": "network-copyleft",
  "AGPL-1.0-or-later": "network-copyleft",
  "AGPL-3.0-only": "network-copyleft",
  "AGPL-3.0-or-later": "network-copyleft",
  "CPAL-1.0": "network-copyleft",
  "RPL-1.5": "network-copyleft",
  "SSPL-1.0": "network-copyleft",

  // ---- Proprietary / no grant --------------------------------------------
  "UNLICENSED": "proprietary",
};

/**
 * Map of common historical / non-canonical license strings to their modern
 * SPDX identifiers. npm packages in the wild use many of these.
 */
const NORMALIZATION_MAP: Readonly<Record<string, string>> = {
  // Deprecated GPL ids without the -only/-or-later disambiguator. npm/SPDX
  // historically treated the bare id as "-only"; we follow that convention.
  "GPL-1.0": "GPL-1.0-only",
  "GPL-1.0+": "GPL-1.0-or-later",
  "GPL-2.0": "GPL-2.0-only",
  "GPL-2.0+": "GPL-2.0-or-later",
  "GPL-3.0": "GPL-3.0-only",
  "GPL-3.0+": "GPL-3.0-or-later",
  "LGPL-2.0": "LGPL-2.0-only",
  "LGPL-2.0+": "LGPL-2.0-or-later",
  "LGPL-2.1": "LGPL-2.1-only",
  "LGPL-2.1+": "LGPL-2.1-or-later",
  "LGPL-3.0": "LGPL-3.0-only",
  "LGPL-3.0+": "LGPL-3.0-or-later",
  "AGPL-1.0": "AGPL-1.0-only",
  "AGPL-3.0": "AGPL-3.0-only",
  // Common free-text spellings.
  "APACHE-2.0": "Apache-2.0",
  "APACHE 2.0": "Apache-2.0",
  "THE MIT LICENSE": "MIT",
  "MIT LICENSE": "MIT",
  "BSD": "BSD-2-Clause",
  "NEW BSD": "BSD-3-Clause",
  "BSD3": "BSD-3-Clause",
  "ISC LICENSE": "ISC",
  "PUBLIC DOMAIN": "Unlicense",
  "CC0": "CC0-1.0",
  "WTFPL-2.0": "WTFPL",
};

/**
 * Categories ordered from least to most restrictive. Used to pick a
 * representative category for compound expressions and to compare strictness.
 */
const RESTRICTIVENESS: LicenseCategory[] = [
  "permissive",
  "weak-copyleft",
  "strong-copyleft",
  "network-copyleft",
  "proprietary",
  "unknown",
];

function restrictivenessRank(category: LicenseCategory): number {
  return RESTRICTIVENESS.indexOf(category);
}

/**
 * Normalise a single SPDX-ish identifier: trim, strip a `WITH <exception>`
 * suffix, map known aliases to canonical ids, and fall back to the base
 * license for a trailing `+` ("or later").
 */
export function normalizeLicenseId(raw: string): string {
  let id = raw.trim();
  // `X WITH Exception` — categorise by the base license X.
  const withIdx = id.search(/\sWITH\s/i);
  if (withIdx !== -1) {
    id = id.slice(0, withIdx).trim();
  }
  // Exact-id match first (preserves canonical casing like `Apache-2.0`).
  if (id in SPDX_CATEGORIES) return id;
  // Alias lookup is case-insensitive. This runs before `+` stripping so that
  // families with an explicit "-or-later" form (e.g. `GPL-2.0+`) keep it.
  const upper = id.toUpperCase();
  if (upper in NORMALIZATION_MAP) {
    return NORMALIZATION_MAP[upper] as string;
  }
  // Case-insensitive match against the canonical map (e.g. `mit` -> `MIT`).
  for (const known of Object.keys(SPDX_CATEGORIES)) {
    if (known.toUpperCase() === upper) return known;
  }
  // Trailing `+` (e.g. `MIT+`, `Zlib+`) — fall back to the base license. Its
  // category is the same; only the "or later" nuance is dropped.
  if (id.endsWith("+")) {
    return normalizeLicenseId(id.slice(0, -1));
  }
  return id;
}

/** Look up the category for a single (already-normalised or raw) SPDX id. */
export function categoryOfId(raw: string): LicenseCategory {
  const id = normalizeLicenseId(raw);
  // npm's "custom license" marker: there is a license, but it is non-standard.
  if (/^SEE LICENSE IN/i.test(id) || /^LicenseRef-/i.test(id)) {
    return "proprietary";
  }
  return SPDX_CATEGORIES[id] ?? "unknown";
}

/**
 * A parsed SPDX expression node. The parser is intentionally pragmatic: it
 * handles single ids, `A OR B`, `A AND B`, and a single wrapping pair of
 * parentheses. Full precedence/nesting is a roadmap item.
 */
export type SpdxNode =
  | { op: "LICENSE"; id: string }
  | { op: "OR"; parts: SpdxNode[] }
  | { op: "AND"; parts: SpdxNode[] };

function stripOuterParens(expr: string): string {
  let e = expr.trim();
  // Strip balanced outer parens only when they wrap the entire expression.
  while (e.startsWith("(") && e.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === "(") depth++;
      else if (e[i] === ")") depth--;
      if (depth === 0 && i < e.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

/** Split an expression on a top-level operator (not inside parentheses). */
function splitTopLevel(expr: string, op: "OR" | "AND"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  const re = new RegExp(`\\s${op}\\s`, "gi");
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(expr);
      if (m && m.index === i) {
        parts.push(expr.slice(last, i));
        i = re.lastIndex - 1;
        last = re.lastIndex;
      }
    }
  }
  if (parts.length === 0) return null;
  parts.push(expr.slice(last));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Parse an SPDX license expression into a tree. OR binds looser than AND, so we
 * split on OR first. Returns a single LICENSE node for plain identifiers.
 */
export function parseSpdxExpression(expr: string): SpdxNode {
  const e = stripOuterParens(expr);
  const orParts = splitTopLevel(e, "OR");
  if (orParts && orParts.length > 1) {
    return { op: "OR", parts: orParts.map(parseSpdxExpression) };
  }
  const andParts = splitTopLevel(e, "AND");
  if (andParts && andParts.length > 1) {
    return { op: "AND", parts: andParts.map(parseSpdxExpression) };
  }
  return { op: "LICENSE", id: e };
}

/**
 * Derive a single representative category for a (possibly compound) license
 * expression.
 *
 * - For `OR`, pick the least restrictive option (the one a consumer would
 *   choose).
 * - For `AND`, pick the most restrictive option (all terms apply at once).
 */
export function categoryOfExpression(expr: string | null): LicenseCategory {
  if (!expr || expr.trim().length === 0) return "unknown";
  const node = parseSpdxExpression(expr);
  return categoryOfNode(node);
}

function categoryOfNode(node: SpdxNode): LicenseCategory {
  if (node.op === "LICENSE") return categoryOfId(node.id);
  const cats = node.parts.map(categoryOfNode);
  if (node.op === "OR") {
    // Least restrictive wins.
    return cats.reduce((best, c) =>
      restrictivenessRank(c) < restrictivenessRank(best) ? c : best,
    );
  }
  // AND: most restrictive wins.
  return cats.reduce((worst, c) =>
    restrictivenessRank(c) > restrictivenessRank(worst) ? c : worst,
  );
}

/** Collect every distinct license id mentioned in an expression. */
export function licenseIdsOf(expr: string | null): string[] {
  if (!expr) return [];
  const ids: string[] = [];
  const visit = (node: SpdxNode): void => {
    if (node.op === "LICENSE") ids.push(node.id);
    else node.parts.forEach(visit);
  };
  visit(parseSpdxExpression(expr));
  return ids;
}

export { restrictivenessRank };
