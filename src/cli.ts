#!/usr/bin/env node
/**
 * license-check CLI.
 *
 * The argument parsing and command dispatch live in `run()`, which is pure with
 * respect to its injected I/O (cwd + write streams) and returns an exit code.
 * This makes the whole CLI unit-testable without spawning a subprocess.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkDependencies, DEFAULT_WALK_OPTIONS } from "./walk.js";
import {
  loadPolicy,
  evaluateAll,
  policyWithFailOnCategories,
  DEFAULT_POLICY,
} from "./policy.js";
import {
  renderScanTable,
  renderJson,
  renderMarkdownReport,
  renderMissing,
} from "./format.js";
import type { LicenseCategory, PolicyConfig, WalkOptions } from "./types.js";

const VALID_CATEGORIES: readonly LicenseCategory[] = [
  "permissive",
  "weak-copyleft",
  "strong-copyleft",
  "network-copyleft",
  "proprietary",
  "unknown",
];

/** Parse and validate a comma-separated `--fail-on` category list. */
function parseFailOn(value: string): { categories: LicenseCategory[]; error?: string } {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    return { categories: [], error: "--fail-on requires at least one category" };
  }
  for (const p of parts) {
    if (!VALID_CATEGORIES.includes(p as LicenseCategory)) {
      return {
        categories: [],
        error: `invalid --fail-on category "${p}" (valid: ${VALID_CATEGORIES.join(", ")})`,
      };
    }
  }
  return { categories: parts as LicenseCategory[] };
}

/** Keep in sync with package.json. Verified by a unit test. */
export const VERSION = "0.1.0";

const DEFAULT_CONFIG_NAME = ".licensecheckrc.json";

export interface CliIO {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command: string | undefined;
  dir: string | undefined;
  policy: string | undefined;
  format: string | undefined;
  failOn: string | undefined;
  includeDev: boolean;
  includeOptional: boolean | undefined;
  allowUnknown: boolean;
  color: boolean;
  help: boolean;
  version: boolean;
  errors: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    dir: undefined,
    policy: undefined,
    format: undefined,
    failOn: undefined,
    includeDev: false,
    includeOptional: undefined,
    allowUnknown: false,
    color: true,
    help: false,
    version: false,
    errors: [],
  };

  const needsValue = (flag: string, value: string | undefined): string => {
    // Reject end-of-argv and a following flag token (e.g. `--policy --json`),
    // which is almost always a missing value rather than an intended one.
    if (value === undefined || value.startsWith("-")) {
      parsed.errors.push(`Missing value for ${flag}`);
      return "";
    }
    return value;
  };

  // Parse a boolean given in `--flag=value` form. Bare presence and any value
  // other than an explicit false/0 means true.
  const parseBool = (value: string): boolean => value !== "false" && value !== "0";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      case "--dir":
        parsed.dir = needsValue(arg, argv[++i]);
        break;
      case "--policy":
        parsed.policy = needsValue(arg, argv[++i]);
        break;
      case "--format":
        parsed.format = needsValue(arg, argv[++i]);
        break;
      case "--fail-on":
        parsed.failOn = needsValue(arg, argv[++i]);
        break;
      case "--include-dev":
        parsed.includeDev = true;
        break;
      case "--no-optional":
        parsed.includeOptional = false;
        break;
      case "--allow-unknown":
        parsed.allowUnknown = true;
        break;
      case "--no-color":
        parsed.color = false;
        break;
      default:
        if (arg.startsWith("--") && arg.includes("=")) {
          // Support --flag=value form for value-taking flags.
          const eq = arg.indexOf("=");
          const flag = arg.slice(0, eq);
          const value = arg.slice(eq + 1);
          if (flag === "--dir") parsed.dir = value;
          else if (flag === "--policy") parsed.policy = value;
          else if (flag === "--format") parsed.format = value;
          else if (flag === "--fail-on") parsed.failOn = value;
          else if (flag === "--include-dev") parsed.includeDev = parseBool(value);
          else if (flag === "--allow-unknown") parsed.allowUnknown = parseBool(value);
          else if (flag === "--no-optional") parsed.includeOptional = !parseBool(value);
          else if (flag === "--no-color") parsed.color = !parseBool(value);
          else parsed.errors.push(`Unknown option: ${flag}`);
        } else if (arg.startsWith("-")) {
          parsed.errors.push(`Unknown option: ${arg}`);
        } else if (parsed.command === undefined) {
          parsed.command = arg;
        } else {
          parsed.errors.push(`Unexpected argument: ${arg}`);
        }
    }
  }

  return parsed;
}

const HELP = `license-check — scan npm dependencies for license policy compliance

USAGE
  license-check <command> [options]

COMMANDS
  scan       Walk dependencies and print a license table
  report     Generate a Markdown (or JSON) license inventory
  missing    List dependencies with no detectable license

OPTIONS
  --dir <path>        Project root to scan (default: current directory)
  --policy <file>     Policy/config file (default: auto-detect ${DEFAULT_CONFIG_NAME})
  --fail-on <cats>    Comma-separated categories to fail on, without a policy
                        file (e.g. strong-copyleft,network-copyleft). Valid:
                        permissive, weak-copyleft, strong-copyleft,
                        network-copyleft, proprietary, unknown
  --format <fmt>      Output format:
                        scan    -> table | json   (default: table)
                        report  -> markdown | json (default: markdown)
                        missing -> table | json    (default: table)
  --include-dev       Include devDependencies in the walk
  --no-optional       Exclude optionalDependencies from the walk
  --allow-unknown     Do not treat unknown/missing licenses as violations
  --no-color          Disable ANSI colour
  -h, --help          Show this help
  -v, --version       Print the version

EXIT CODES
  0  success, no policy violations
  1  policy violations found
  2  usage or runtime error

license-check is informational, NOT legal advice. Verify against actual
license texts and consult a professional for compliance decisions.`;

/** Resolve the project root directory from a possibly-relative --dir value. */
function resolveDir(cwd: string, dir: string | undefined): string {
  if (!dir) return cwd;
  return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

/** Determine the policy file path: explicit flag, else auto-detected default. */
function resolvePolicyPath(
  rootDir: string,
  cwd: string,
  policyFlag: string | undefined,
): string | undefined {
  if (policyFlag) {
    return isAbsolute(policyFlag) ? policyFlag : resolve(cwd, policyFlag);
  }
  const auto = join(rootDir, DEFAULT_CONFIG_NAME);
  return existsSync(auto) ? auto : undefined;
}

/** Merge policy `include` settings with CLI flags into concrete walk options. */
function resolveWalkOptions(policy: PolicyConfig, args: ParsedArgs): WalkOptions {
  const inc = policy.include ?? {};
  return {
    includeDependencies: inc.dependencies ?? DEFAULT_WALK_OPTIONS.includeDependencies,
    includeDevDependencies:
      args.includeDev || (inc.devDependencies ?? DEFAULT_WALK_OPTIONS.includeDevDependencies),
    includeOptionalDependencies:
      args.includeOptional ??
      inc.optionalDependencies ??
      DEFAULT_WALK_OPTIONS.includeOptionalDependencies,
    includePeerDependencies:
      inc.peerDependencies ?? DEFAULT_WALK_OPTIONS.includePeerDependencies,
  };
}

/**
 * Run the CLI. Returns a process exit code. All output goes through the
 * injected `io` so tests can capture it.
 */
export function run(argv: string[], io: CliIO): number {
  const args = parseArgs(argv);

  if (args.version) {
    io.stdout(VERSION);
    return 0;
  }
  // Explicit --help always wins and succeeds.
  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  // Surface parse errors before anything else (so e.g. `license-check --bogus`
  // reports the bad flag instead of silently printing help).
  if (args.errors.length > 0) {
    for (const e of args.errors) io.stderr(`error: ${e}`);
    io.stderr("\nRun `license-check --help` for usage.");
    return 2;
  }
  // No command: print help as guidance, but signal misuse via exit code.
  if (args.command === undefined) {
    io.stdout(HELP);
    return 2;
  }

  if (!["scan", "report", "missing"].includes(args.command)) {
    io.stderr(`error: unknown command "${args.command}"`);
    io.stderr("Run `license-check --help` for usage.");
    return 2;
  }

  const rootDir = resolveDir(io.cwd, args.dir);

  // Load policy (explicit or auto-detected). Validation errors are fatal.
  let policy: PolicyConfig = DEFAULT_POLICY;
  let policyPath: string | undefined;
  try {
    policyPath = resolvePolicyPath(rootDir, io.cwd, args.policy);
    if (policyPath) policy = loadPolicy(policyPath);
  } catch (err) {
    io.stderr(`error: ${(err as Error).message}`);
    return 2;
  }
  if (args.allowUnknown) policy = { ...policy, allowUnknown: true };

  // `--fail-on <categories>` derives a quick-gate policy on top of whatever was
  // loaded, failing on the listed categories without needing a policy file.
  let failOnActive = false;
  if (args.failOn !== undefined) {
    const { categories, error } = parseFailOn(args.failOn);
    if (error) {
      io.stderr(`error: ${error}`);
      return 2;
    }
    policy = policyWithFailOnCategories(policy, categories);
    failOnActive = true;
  }

  const walkOptions = resolveWalkOptions(policy, args);

  let packages;
  try {
    packages = walkDependencies(rootDir, walkOptions);
  } catch (err) {
    io.stderr(`error: ${(err as Error).message}`);
    return 2;
  }

  switch (args.command) {
    case "scan":
      return runScan(packages, policy, policyPath !== undefined || failOnActive, args, io);
    case "report":
      return runReport(packages, args, io);
    case "missing":
      return runMissing(packages, args, io);
    default:
      return 2;
  }
}

function runScan(
  packages: ReturnType<typeof walkDependencies>,
  policy: PolicyConfig,
  policyConfigured: boolean,
  args: ParsedArgs,
  io: CliIO,
): number {
  const hasPolicy = policyConfigured || args.allowUnknown;
  const { evaluations, violations } = evaluateAll(packages, policy);
  const format = args.format ?? "table";

  if (format === "json") {
    io.stdout(renderJson(packages, hasPolicy ? evaluations : undefined));
  } else if (format === "table") {
    io.stdout(
      renderScanTable(packages, {
        color: args.color,
        evaluations: hasPolicy ? evaluations : undefined,
      }),
    );
  } else {
    io.stderr(`error: unknown format "${format}" for scan (use table|json)`);
    return 2;
  }

  if (hasPolicy && violations.length > 0) {
    io.stderr(`\n${violations.length} policy violation(s):`);
    for (const v of violations) {
      io.stderr(`  - ${v.pkg.name}@${v.pkg.version}: ${v.reason}`);
    }
    return 1;
  }
  return 0;
}

function runReport(
  packages: ReturnType<typeof walkDependencies>,
  args: ParsedArgs,
  io: CliIO,
): number {
  const format = args.format ?? "markdown";
  if (format === "markdown") {
    io.stdout(renderMarkdownReport(packages));
    return 0;
  }
  if (format === "json") {
    io.stdout(renderJson(packages));
    return 0;
  }
  io.stderr(`error: unknown format "${format}" for report (use markdown|json)`);
  return 2;
}

function runMissing(
  packages: ReturnType<typeof walkDependencies>,
  args: ParsedArgs,
  io: CliIO,
): number {
  const missing = packages.filter((p) => p.license === null);
  const format = args.format ?? "table";
  if (format === "json") {
    io.stdout(renderJson(missing));
  } else if (format === "table") {
    io.stdout(renderMissing(missing, args.color));
  } else {
    io.stderr(`error: unknown format "${format}" for missing (use table|json)`);
    return 2;
  }
  // `missing` is informational; it exits non-zero only when something is found,
  // so it can be used as a lightweight gate in CI if desired.
  return missing.length > 0 ? 1 : 0;
}

// --- bin entry ------------------------------------------------------------

// Only auto-run when executed directly (not when imported by tests). Comparing
// real paths handles the npm `.bin` symlink, where `process.argv[1]` is the
// symlink and `import.meta.url` is the resolved target.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const code = run(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (t) => process.stdout.write(t + "\n"),
    stderr: (t) => process.stderr.write(t + "\n"),
  });
  process.exitCode = code;
}
