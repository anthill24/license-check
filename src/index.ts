/**
 * Public library API for license-check.
 *
 * Importing `license-check` programmatically gives you the same building blocks
 * the CLI uses. Everything here is offline and side-effect free (no network).
 *
 * @example
 * ```ts
 * import { walkDependencies, evaluateAll, loadPolicy } from "license-check";
 *
 * const packages = walkDependencies(process.cwd());
 * const policy = loadPolicy(".licensecheckrc.json");
 * const { violations } = evaluateAll(packages, policy);
 * if (violations.length) process.exit(1);
 * ```
 */
export type {
  Evaluation,
  LicenseCategory,
  LicenseSource,
  PackageRecord,
  PolicyConfig,
  WalkOptions,
} from "./types.js";

export {
  SPDX_CATEGORIES,
  categoryOfId,
  categoryOfExpression,
  normalizeLicenseId,
  parseSpdxExpression,
  licenseIdsOf,
  type SpdxNode,
} from "./spdx.js";

export {
  detectLicense,
  identifyLicenseText,
  readManifest,
  type DetectionResult,
  type RawManifest,
} from "./detect.js";

export { walkDependencies, DEFAULT_WALK_OPTIONS } from "./walk.js";

export {
  loadPolicy,
  validatePolicy,
  evaluatePackage,
  evaluateAll,
  policyWithFailOnCategories,
  DEFAULT_POLICY,
} from "./policy.js";

export {
  renderScanTable,
  renderJson,
  renderMarkdownReport,
  renderMissing,
  summarizeCategories,
  DISCLAIMER,
} from "./format.js";
