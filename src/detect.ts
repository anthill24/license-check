/**
 * Detect the license of an installed package from its on-disk artifacts.
 *
 * Detection order (first hit wins):
 *   1. `package.json` `license` field (string SPDX expression)
 *   2. `package.json` `license` field (deprecated `{ type, url }` object form)
 *   3. `package.json` `licenses` array (deprecated `[{ type, url }]` form)
 *   4. A `LICENSE`/`COPYING` file in the package root, matched against a small
 *      set of well-known license signatures.
 *
 * Everything is read from disk; nothing hits the network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LicenseSource } from "./types.js";

export interface DetectionResult {
  /** SPDX expression (or custom marker), or `null` when nothing was found. */
  license: string | null;
  source: LicenseSource;
}

/** Minimal shape of the fields we read from a package.json. */
export interface RawManifest {
  name?: string;
  version?: string;
  license?: string | { type?: string; url?: string };
  // Deprecated npm field, still seen in older packages.
  licenses?: Array<{ type?: string; url?: string }> | { type?: string };
}

/**
 * Candidate filenames for a bundled license file, in priority order.
 * Case-insensitive matching is applied against the real directory listing.
 */
const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "LICENSE-MIT",
  "COPYING",
  "COPYING.md",
  "COPYING.txt",
  "UNLICENSE",
];

/**
 * Ordered signature table for matching license-file contents to an SPDX id.
 * Order matters: more specific matchers (e.g. AGPL before GPL) come first.
 * Each `test` receives the normalised (whitespace-collapsed) file text.
 */
interface Signature {
  id: string;
  test: (text: string) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    id: "MPL-2.0",
    test: (t) => t.includes("MOZILLA PUBLIC LICENSE") && t.includes("VERSION 2.0"),
  },
  {
    id: "Apache-2.0",
    test: (t) => t.includes("APACHE LICENSE") && t.includes("VERSION 2.0"),
  },
  {
    id: "BSL-1.0",
    test: (t) => t.includes("BOOST SOFTWARE LICENSE"),
  },
  {
    id: "Unlicense",
    test: (t) =>
      t.includes("THIS IS FREE AND UNENCUMBERED SOFTWARE RELEASED INTO THE PUBLIC DOMAIN"),
  },
  {
    id: "WTFPL",
    test: (t) => t.includes("DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE"),
  },
  {
    id: "BSD-3-Clause",
    test: (t) =>
      t.includes("REDISTRIBUTION AND USE IN SOURCE AND BINARY FORMS") &&
      (t.includes("NEITHER THE NAME") || t.includes("NAMES OF ITS CONTRIBUTORS")),
  },
  {
    id: "BSD-2-Clause",
    test: (t) => t.includes("REDISTRIBUTION AND USE IN SOURCE AND BINARY FORMS"),
  },
  {
    id: "ISC",
    test: (t) =>
      t.includes("PERMISSION TO USE, COPY, MODIFY, AND/OR DISTRIBUTE THIS SOFTWARE"),
  },
  {
    id: "MIT",
    test: (t) =>
      t.includes("PERMISSION IS HEREBY GRANTED, FREE OF CHARGE") &&
      t.includes("WITHOUT RESTRICTION"),
  },
];

/** Read and JSON-parse a package.json, returning `null` on any failure. */
export function readManifest(pkgDir: string): RawManifest | null {
  try {
    const raw = readFileSync(join(pkgDir, "package.json"), "utf8");
    return JSON.parse(raw) as RawManifest;
  } catch {
    return null;
  }
}

/** Extract a license string from a parsed manifest, if present and non-empty. */
function licenseFromManifest(manifest: RawManifest): DetectionResult | null {
  const { license, licenses } = manifest;

  if (typeof license === "string" && license.trim().length > 0) {
    return { license: license.trim(), source: "package.json:license" };
  }

  // Deprecated object form: { "license": { "type": "MIT", "url": "..." } }
  if (license && typeof license === "object" && typeof license.type === "string") {
    const type = license.type.trim();
    if (type.length > 0) {
      return { license: type, source: "package.json:license-object" };
    }
  }

  // Deprecated array form: { "licenses": [{ "type": "MIT" }, ...] }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((l) => (typeof l?.type === "string" ? l.type.trim() : ""))
      .filter((t) => t.length > 0);
    if (types.length === 1) {
      return { license: types[0] as string, source: "package.json:licenses" };
    }
    if (types.length > 1) {
      // Historically multiple entries meant "your choice of" => OR.
      return { license: `(${types.join(" OR ")})`, source: "package.json:licenses" };
    }
  }

  // Deprecated singular object under `licenses`.
  if (
    licenses &&
    !Array.isArray(licenses) &&
    typeof (licenses as { type?: string }).type === "string"
  ) {
    const type = (licenses as { type?: string }).type!.trim();
    if (type.length > 0) {
      return { license: type, source: "package.json:licenses" };
    }
  }

  return null;
}

/** Find a bundled license file in `pkgDir`, matched case-insensitively. */
function findLicenseFile(pkgDir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(pkgDir);
  } catch {
    return null;
  }
  const lowerToActual = new Map<string, string>();
  for (const entry of entries) lowerToActual.set(entry.toLowerCase(), entry);
  for (const candidate of LICENSE_FILENAMES) {
    const actual = lowerToActual.get(candidate.toLowerCase());
    if (actual) return join(pkgDir, actual);
  }
  return null;
}

/**
 * Disambiguate the GNU license family by which title appears *first* in the
 * text. The real license title is at the top of the file, while GPL text can
 * reference "GNU Affero General Public License" deep in its body (section 13).
 * Picking the earliest-occurring title avoids misclassifying GPL as AGPL — a
 * fixed AGPL-before-GPL substring order would get this wrong on full GPL text.
 */
function identifyGnuFamily(t: string): string | null {
  const affero = t.indexOf("GNU AFFERO GENERAL PUBLIC LICENSE");
  const lesser = t.indexOf("GNU LESSER GENERAL PUBLIC LICENSE");
  const gpl = t.indexOf("GNU GENERAL PUBLIC LICENSE");
  if (affero < 0 && lesser < 0 && gpl < 0) return null;

  const rank = (n: number): number => (n < 0 ? Number.POSITIVE_INFINITY : n);
  const earliest = Math.min(rank(affero), rank(lesser), rank(gpl));

  if (earliest === rank(affero)) {
    return t.includes("VERSION 3") ? "AGPL-3.0-only" : "AGPL-1.0-only";
  }
  if (earliest === rank(lesser)) {
    if (t.includes("VERSION 3")) return "LGPL-3.0-only";
    if (t.includes("VERSION 2.1")) return "LGPL-2.1-only";
    return "LGPL-2.1-only";
  }
  // Plain GPL. Check the newest version first so a stray older-version
  // cross-reference cannot win.
  if (t.includes("VERSION 3")) return "GPL-3.0-only";
  if (t.includes("VERSION 2")) return "GPL-2.0-only";
  return "GPL-3.0-only";
}

/**
 * Identify an SPDX id from license-file text using the signature table.
 * Exported for direct testing of the matcher.
 */
export function identifyLicenseText(text: string): string | null {
  // Collapse whitespace and upper-case so signatures can be written plainly.
  const normalized = text.replace(/\s+/g, " ").toUpperCase();
  // The GNU family needs order-independent disambiguation (see above); other
  // licenses are unambiguous via their distinctive phrases.
  const gnu = identifyGnuFamily(normalized);
  if (gnu) return gnu;
  for (const sig of SIGNATURES) {
    if (sig.test(normalized)) return sig.id;
  }
  return null;
}

/** Detect a license from a bundled LICENSE/COPYING file, if any. */
function licenseFromFile(pkgDir: string): DetectionResult | null {
  const file = findLicenseFile(pkgDir);
  if (!file) return null;
  let text: string;
  try {
    // Read a bounded prefix — license headers are at the top and files can be
    // large. 16 KiB is comfortably enough for every signature above.
    const buf = readFileSync(file);
    text = buf.subarray(0, 16 * 1024).toString("utf8");
  } catch {
    return null;
  }
  const id = identifyLicenseText(text);
  if (id) return { license: id, source: "license-file" };
  return null;
}

/**
 * Detect the license for a package directory. Returns `{ license: null,
 * source: "none" }` when nothing could be determined.
 *
 * @param pkgDir   Absolute path to the package directory.
 * @param manifest Optional pre-read manifest to avoid a second disk read.
 */
export function detectLicense(pkgDir: string, manifest?: RawManifest | null): DetectionResult {
  const mf = manifest ?? readManifest(pkgDir);
  if (mf) {
    const fromManifest = licenseFromManifest(mf);
    if (fromManifest) return fromManifest;
  }
  const fromFile = licenseFromFile(pkgDir);
  if (fromFile) return fromFile;
  return { license: null, source: "none" };
}
