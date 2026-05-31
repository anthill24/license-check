/**
 * Load a policy/config file and evaluate packages against it.
 *
 * Evaluation semantics for a single package:
 *   1. Apply any per-package override (by `name` or `name@version`).
 *   2. Determine the license expression and evaluate it:
 *        - A bare license id is "allowed" when it is not denied AND (it is in
 *          the allow-list OR its category is allowed).
 *        - `A OR B` is allowed when at least one operand is allowed (a consumer
 *          may pick the acceptable one); unknown if no operand is allowed but
 *          some operand is unknown; otherwise denied.
 *        - `A AND B` is allowed only when every operand is allowed; unknown if
 *          any operand is unknown (and none denied); otherwise denied.
 *   3. A missing license (`null`) is `unknown`, which counts as a violation
 *      unless `allowUnknown` is set.
 *
 * "Allowed/denied/unknown" are policy outcomes, not legal conclusions.
 */
import { readFileSync } from "node:fs";
import {
  categoryOfId,
  normalizeLicenseId,
  parseSpdxExpression,
  type SpdxNode,
} from "./spdx.js";
import type { Evaluation, LicenseCategory, PackageRecord, PolicyConfig } from "./types.js";

/** Default policy when none is supplied: report only, never fail. */
export const DEFAULT_POLICY: PolicyConfig = {};

const VALID_CATEGORIES = new Set([
  "permissive",
  "weak-copyleft",
  "strong-copyleft",
  "network-copyleft",
  "proprietary",
  "unknown",
]);

/**
 * Parse and minimally validate a policy object. Throws on structurally invalid
 * input so misconfiguration fails loudly rather than silently allowing
 * everything.
 */
export function validatePolicy(input: unknown): PolicyConfig {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Policy file must be a JSON object");
  }
  const obj = input as Record<string, unknown>;
  const policy: PolicyConfig = {};

  if (obj.allowedCategories !== undefined) {
    if (!Array.isArray(obj.allowedCategories)) {
      throw new Error("`allowedCategories` must be an array");
    }
    for (const c of obj.allowedCategories) {
      if (typeof c !== "string" || !VALID_CATEGORIES.has(c)) {
        throw new Error(`Invalid category in allowedCategories: ${JSON.stringify(c)}`);
      }
    }
    policy.allowedCategories = obj.allowedCategories as PolicyConfig["allowedCategories"];
  }

  for (const key of ["allow", "deny"] as const) {
    if (obj[key] !== undefined) {
      if (!Array.isArray(obj[key]) || (obj[key] as unknown[]).some((x) => typeof x !== "string")) {
        throw new Error(`\`${key}\` must be an array of SPDX id strings`);
      }
      policy[key] = obj[key] as string[];
    }
  }

  if (obj.overrides !== undefined) {
    if (typeof obj.overrides !== "object" || obj.overrides === null || Array.isArray(obj.overrides)) {
      throw new Error("`overrides` must be an object mapping package -> license");
    }
    for (const [pkg, value] of Object.entries(obj.overrides as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`override for ${JSON.stringify(pkg)} must be an SPDX id string`);
      }
    }
    policy.overrides = obj.overrides as Record<string, string>;
  }

  if (obj.allowUnknown !== undefined) {
    if (typeof obj.allowUnknown !== "boolean") {
      throw new Error("`allowUnknown` must be a boolean");
    }
    policy.allowUnknown = obj.allowUnknown;
  }

  if (obj.include !== undefined) {
    if (typeof obj.include !== "object" || obj.include === null || Array.isArray(obj.include)) {
      throw new Error("`include` must be an object");
    }
    const allowedIncludeKeys = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];
    for (const [key, value] of Object.entries(obj.include as Record<string, unknown>)) {
      if (!allowedIncludeKeys.includes(key)) {
        throw new Error(`Unknown key in \`include\`: ${JSON.stringify(key)}`);
      }
      if (typeof value !== "boolean") {
        throw new Error(`\`include.${key}\` must be a boolean`);
      }
    }
    policy.include = obj.include as PolicyConfig["include"];
  }

  return policy;
}

/** Load and validate a policy file from disk. Throws on read/parse errors. */
export function loadPolicy(path: string): PolicyConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`Could not read policy file ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Policy file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return validatePolicy(parsed);
}

/** The five concrete (non-`unknown`) license categories. */
const CONCRETE_CATEGORIES: LicenseCategory[] = [
  "permissive",
  "weak-copyleft",
  "strong-copyleft",
  "network-copyleft",
  "proprietary",
];

/**
 * Derive a policy that fails on a specific set of categories, without requiring
 * a full policy file. This powers the `--fail-on` CLI flag.
 *
 * It is a precise gate: the resulting policy allows every concrete category
 * except those listed. Unknown/missing licenses fail only when `"unknown"` is
 * explicitly listed; otherwise the existing `allowUnknown` setting is preserved
 * (defaulting to permissive, so `--fail-on strong-copyleft` fails *only* on
 * strong copyleft). When a base policy already restricts `allowedCategories`,
 * the listed categories are removed from it (further restriction, never
 * widening).
 */
export function policyWithFailOnCategories(
  policy: PolicyConfig,
  failOn: LicenseCategory[],
): PolicyConfig {
  const base = policy.allowedCategories ?? CONCRETE_CATEGORIES;
  const allowedCategories = base.filter((c) => !failOn.includes(c));
  const failUnknown = failOn.includes("unknown");
  return {
    ...policy,
    allowedCategories,
    allowUnknown: failUnknown ? false : (policy.allowUnknown ?? true),
  };
}

/** Per-id verdict used while evaluating an expression tree. */
type IdVerdict = "allowed" | "denied" | "unknown";

function evaluateId(id: string, policy: PolicyConfig): IdVerdict {
  const normalized = normalizeLicenseId(id);
  const deny = (policy.deny ?? []).map(normalizeLicenseId);
  const allow = (policy.allow ?? []).map(normalizeLicenseId);

  if (deny.includes(normalized)) return "denied";
  if (allow.includes(normalized)) return "allowed";

  const category = categoryOfId(id);
  if (category === "unknown") return "unknown";

  // No allowedCategories specified => every (known) category is permitted.
  if (!policy.allowedCategories) return "allowed";
  return policy.allowedCategories.includes(category) ? "allowed" : "denied";
}

function evaluateNode(node: SpdxNode, policy: PolicyConfig): IdVerdict {
  if (node.op === "LICENSE") return evaluateId(node.id, policy);
  const verdicts = node.parts.map((n) => evaluateNode(n, policy));
  if (node.op === "OR") {
    if (verdicts.includes("allowed")) return "allowed";
    if (verdicts.includes("unknown")) return "unknown";
    return "denied";
  }
  // AND: all must be allowed.
  if (verdicts.includes("denied")) return "denied";
  if (verdicts.includes("unknown")) return "unknown";
  return "allowed";
}

/** Apply a per-package override, returning the effective license expression. */
function applyOverride(pkg: PackageRecord, policy: PolicyConfig): string | null {
  const overrides = policy.overrides;
  if (!overrides) return pkg.license;
  const versioned = `${pkg.name}@${pkg.version}`;
  if (versioned in overrides) return overrides[versioned] as string;
  if (pkg.name in overrides) return overrides[pkg.name] as string;
  return pkg.license;
}

/** Evaluate one package against a policy. */
export function evaluatePackage(pkg: PackageRecord, policy: PolicyConfig): Evaluation {
  const effectiveLicense = applyOverride(pkg, policy);

  if (!effectiveLicense || effectiveLicense.trim().length === 0) {
    const allowUnknown = policy.allowUnknown ?? false;
    return {
      pkg,
      status: allowUnknown ? "allowed" : "unknown",
      reason: allowUnknown
        ? "No license detected (allowed by allowUnknown)"
        : "No license detected",
    };
  }

  const verdict = evaluateNode(parseSpdxExpression(effectiveLicense), policy);

  if (verdict === "unknown") {
    const allowUnknown = policy.allowUnknown ?? false;
    return {
      pkg,
      status: allowUnknown ? "allowed" : "unknown",
      reason: allowUnknown
        ? `Unrecognised license "${effectiveLicense}" (allowed by allowUnknown)`
        : `Unrecognised license "${effectiveLicense}"`,
    };
  }

  if (verdict === "denied") {
    return {
      pkg,
      status: "denied",
      reason: `License "${effectiveLicense}" (category: ${pkg.category}) is not permitted by policy`,
    };
  }

  return {
    pkg,
    status: "allowed",
    reason: `License "${effectiveLicense}" is permitted`,
  };
}

/** Evaluate every package and partition the results. */
export function evaluateAll(
  packages: PackageRecord[],
  policy: PolicyConfig,
): { evaluations: Evaluation[]; violations: Evaluation[] } {
  const evaluations = packages.map((p) => evaluatePackage(p, policy));
  // A violation is anything not explicitly allowed.
  const violations = evaluations.filter((e) => e.status !== "allowed");
  return { evaluations, violations };
}
