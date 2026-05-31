/**
 * Shared types for license-check.
 *
 * license-check is an informational tool. The "category" assigned to a license
 * is a coarse, opinionated grouping to help triage — it is NOT legal advice and
 * is not a substitute for reading the license text or consulting a lawyer.
 */

/**
 * Coarse license categories used for policy decisions and reporting.
 *
 * - `permissive`        — minimal restrictions (MIT, BSD, Apache-2.0, ISC, ...)
 * - `weak-copyleft`     — file/library-level copyleft (LGPL, MPL-2.0, EPL, ...)
 * - `strong-copyleft`   — project-level copyleft (GPL family)
 * - `network-copyleft`  — copyleft triggered by network use (AGPL, SSPL, ...)
 * - `proprietary`       — no/custom grant (UNLICENSED, commercial, SEE LICENSE IN ...)
 * - `unknown`           — could not be determined or not in the bundled map
 */
export type LicenseCategory =
  | "permissive"
  | "weak-copyleft"
  | "strong-copyleft"
  | "network-copyleft"
  | "proprietary"
  | "unknown";

/** Where a detected license string came from, for transparency in output. */
export type LicenseSource =
  | "package.json:license"
  | "package.json:license-object"
  | "package.json:licenses"
  | "license-file"
  | "none";

/** A single resolved package in the dependency tree. */
export interface PackageRecord {
  /** Package name, e.g. `lodash` or `@scope/pkg`. */
  name: string;
  /** Resolved version, or `"unknown"` if the package.json had none. */
  version: string;
  /** Absolute path to the installed package directory. */
  path: string;
  /**
   * Raw SPDX license expression as detected, or `null` when nothing was found.
   * Examples: `"MIT"`, `"(MIT OR Apache-2.0)"`, `"UNLICENSED"`.
   */
  license: string | null;
  /** How the license was detected. */
  source: LicenseSource;
  /** Coarse category derived from {@link license}. */
  category: LicenseCategory;
  /**
   * Dependency relationship to the project root for the closest path found.
   * `direct` = listed in the root manifest; `transitive` = pulled in indirectly.
   */
  relation: "direct" | "transitive";
}

/** Policy / configuration shape (`.licensecheckrc.json`). */
export interface PolicyConfig {
  /** Categories that are permitted. If omitted, all categories are permitted. */
  allowedCategories?: LicenseCategory[];
  /** SPDX ids that are always permitted, overriding category rules. */
  allow?: string[];
  /** SPDX ids that are always forbidden, overriding allow/category rules. */
  deny?: string[];
  /**
   * Per-package license overrides. Keyed by `name` or `name@version`.
   * The value is treated as the package's license expression.
   */
  overrides?: Record<string, string>;
  /**
   * When `true`, packages with an unknown/undetectable license do not count as
   * violations. Defaults to `false` (unknown licenses are flagged).
   */
  allowUnknown?: boolean;
  /** Which dependency scopes to include when walking. */
  include?: {
    dependencies?: boolean;
    devDependencies?: boolean;
    optionalDependencies?: boolean;
    peerDependencies?: boolean;
  };
}

/** The verdict for a single package after evaluating it against a policy. */
export interface Evaluation {
  pkg: PackageRecord;
  status: "allowed" | "denied" | "unknown";
  /** Human-readable explanation of the verdict. */
  reason: string;
}

/** Options controlling a dependency-tree walk. */
export interface WalkOptions {
  includeDependencies: boolean;
  includeDevDependencies: boolean;
  includeOptionalDependencies: boolean;
  includePeerDependencies: boolean;
}
