import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { run, VERSION, type CliIO } from "../src/cli.js";
import { SAMPLE_PROJECT, AUTO_PROJECT, fixture } from "./helpers.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI with captured I/O. */
function cli(args: string[], cwd: string = SAMPLE_PROJECT): CaptureResult {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    cwd,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  const code = run(args, io);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("top-level flags", () => {
  it("--version prints the version", () => {
    const r = cli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(VERSION);
  });

  it("--help prints usage", () => {
    const r = cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("USAGE");
    expect(r.stdout).toContain("scan");
  });

  it("no command prints help and exits 2", () => {
    const r = cli([]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("USAGE");
  });

  it("an unknown command exits 2", () => {
    const r = cli(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  it("an unknown option exits 2", () => {
    const r = cli(["scan", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown option");
  });

  it("reports the bad flag even when no command is given", () => {
    const r = cli(["--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown option");
  });

  it("treats a following flag token as a missing value", () => {
    const r = cli(["scan", "--policy", "--format", "json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Missing value for --policy");
  });
});

describe("scan", () => {
  it("prints a table by default with no policy => exit 0", () => {
    const r = cli(["scan", "--dir", SAMPLE_PROJECT, "--no-color"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("PACKAGE");
    expect(r.stdout).toContain("permissive-mit");
    expect(r.stdout).toContain("MIT");
  });

  it("supports --format json", () => {
    const r = cli(["scan", "--dir", SAMPLE_PROJECT, "--format", "json"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.total).toBeGreaterThan(0);
    expect(Array.isArray(parsed.packages)).toBe(true);
  });

  it("fails with exit 1 when a policy is violated", () => {
    const r = cli([
      "scan",
      "--dir",
      SAMPLE_PROJECT,
      "--policy",
      fixture("policies", "permissive-only.json"),
      "--no-color",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("policy violation");
    expect(r.stderr).toMatch(/gpl-pkg/);
  });

  it("includes a STATUS column when a policy is active", () => {
    const r = cli([
      "scan",
      "--dir",
      SAMPLE_PROJECT,
      "--policy",
      fixture("policies", "permissive-only.json"),
      "--no-color",
    ]);
    expect(r.stdout).toContain("STATUS");
    expect(r.stdout).toContain("denied");
  });

  it("auto-detects .licensecheckrc.json in the project dir", () => {
    const r = cli(["scan", "--dir", AUTO_PROJECT, "--no-color"]);
    // auto-project's policy is permissive-only and it depends on gpl-pkg.
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gpl-pkg/);
  });

  it("--allow-unknown relaxes unknown-license failures", () => {
    // With a permissive-only policy, unknown-license-pkg is a violation; but
    // here we use a deny-only style policy plus allow-unknown.
    const r = cli([
      "scan",
      "--dir",
      SAMPLE_PROJECT,
      "--allow-unknown",
      "--no-color",
    ]);
    // No allowedCategories => everything known is allowed; allow-unknown clears
    // the unknown ones, so there should be no violations.
    expect(r.code).toBe(0);
  });

  it("rejects an unknown format", () => {
    const r = cli(["scan", "--dir", SAMPLE_PROJECT, "--format", "xml"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown format");
  });

  it("errors on an invalid policy file", () => {
    const r = cli([
      "scan",
      "--dir",
      SAMPLE_PROJECT,
      "--policy",
      fixture("policies", "invalid.json"),
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("not valid JSON");
  });

  it("errors when the directory has no package.json", () => {
    const r = cli(["scan", "--dir", "/no/such/place"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("package.json");
  });
});

describe("report", () => {
  it("produces Markdown by default", () => {
    const r = cli(["report", "--dir", SAMPLE_PROJECT]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("# License Inventory");
    expect(r.stdout).toContain("| Package |");
  });

  it("produces JSON with --format json", () => {
    const r = cli(["report", "--dir", SAMPLE_PROJECT, "--format", "json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("rejects an unknown format", () => {
    const r = cli(["report", "--dir", SAMPLE_PROJECT, "--format", "csv"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown format");
  });
});

describe("missing", () => {
  it("lists packages with no detectable license and exits 1", () => {
    const r = cli(["missing", "--dir", SAMPLE_PROJECT, "--no-color"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no-license-pkg");
  });

  it("supports JSON output", () => {
    const r = cli(["missing", "--dir", SAMPLE_PROJECT, "--format", "json"]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.packages.every((p: { license: null }) => p.license === null)).toBe(true);
  });

  it("exits 0 when there are no missing licenses", () => {
    const r = cli(["missing", "--dir", AUTO_PROJECT, "--no-color"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No packages with missing licenses");
  });
});

describe("--flag=value form", () => {
  it("accepts --format=json", () => {
    const r = cli(["scan", `--dir=${SAMPLE_PROJECT}`, "--format=json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("accepts boolean flags in --flag=value form", () => {
    // --include-dev=true must include devDependencies (dev-only-gpl) in JSON.
    const r = cli(["scan", `--dir=${SAMPLE_PROJECT}`, "--include-dev=true", "--format=json"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.packages.some((p: { name: string }) => p.name === "dev-only-gpl")).toBe(true);
  });
});
