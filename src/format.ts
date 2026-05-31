/**
 * Output renderers: plain-text table, JSON, and Markdown.
 *
 * No third-party formatting dependencies — keeping the runtime dependency tree
 * empty means license-check's own license report is trivially clean.
 */
import type { Evaluation, LicenseCategory, PackageRecord } from "./types.js";

const DISCLAIMER =
  "license-check provides informational output to help triage license usage. " +
  "It is NOT legal advice. License categorisation is heuristic and may be wrong; " +
  "always verify against the actual license text.";

export { DISCLAIMER };

/** ANSI helpers (no dependency). Disabled when `color` is false. */
function colorize(text: string, code: string, enabled: boolean): string {
  return enabled ? `[${code}m${text}[0m` : text;
}

const CATEGORY_COLORS: Record<LicenseCategory, string> = {
  permissive: "32", // green
  "weak-copyleft": "33", // yellow
  "strong-copyleft": "31", // red
  "network-copyleft": "31", // red
  proprietary: "35", // magenta
  unknown: "90", // grey
};

/** Render a simple left-aligned column table from a header + rows. */
function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const pad = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] as number)).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [pad(header), sep, ...rows.map(pad)].join("\n");
}

export interface ScanRenderOptions {
  color: boolean;
  /** When provided, a Status column is appended from these evaluations. */
  evaluations?: Evaluation[];
}

/** Human-readable table for the `scan` command. */
export function renderScanTable(
  packages: PackageRecord[],
  options: ScanRenderOptions,
): string {
  const statusByKey = new Map<string, Evaluation>();
  if (options.evaluations) {
    for (const e of options.evaluations) {
      statusByKey.set(`${e.pkg.name}@${e.pkg.version}@${e.pkg.path}`, e);
    }
  }

  const header = ["PACKAGE", "VERSION", "LICENSE", "CATEGORY"];
  if (options.evaluations) header.push("STATUS");

  const rows = packages.map((p) => {
    const license = p.license ?? "(none)";
    const category = colorize(
      p.category,
      CATEGORY_COLORS[p.category],
      options.color,
    );
    const row = [p.name, p.version, license, category];
    if (options.evaluations) {
      const evaln = statusByKey.get(`${p.name}@${p.version}@${p.path}`);
      // Default to "unknown" (not "allowed") so a key mismatch can never mask a
      // package as compliant. In practice evaluations always cover every row.
      const status = evaln?.status ?? "unknown";
      const code = status === "allowed" ? "32" : status === "denied" ? "31" : "33";
      row.push(colorize(status, code, options.color));
    }
    return row;
  });

  const counts = summarizeCategories(packages);
  const summaryLine = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${cat}: ${n}`)
    .join(", ");

  return [
    renderTable(header, rows),
    "",
    `${packages.length} package(s). ${summaryLine}`,
    "",
    DISCLAIMER,
  ].join("\n");
}

/** Count packages per category. */
export function summarizeCategories(
  packages: PackageRecord[],
): Record<LicenseCategory, number> {
  const counts: Record<LicenseCategory, number> = {
    permissive: 0,
    "weak-copyleft": 0,
    "strong-copyleft": 0,
    "network-copyleft": 0,
    proprietary: 0,
    unknown: 0,
  };
  for (const p of packages) counts[p.category]++;
  return counts;
}

/** Machine-readable JSON for `scan` / `missing`. */
export function renderJson(
  packages: PackageRecord[],
  evaluations?: Evaluation[],
): string {
  const payload = {
    disclaimer: DISCLAIMER,
    summary: {
      total: packages.length,
      categories: summarizeCategories(packages),
      ...(evaluations
        ? {
            violations: evaluations.filter((e) => e.status !== "allowed").length,
          }
        : {}),
    },
    packages: packages.map((p) => {
      const evaln = evaluations?.find(
        (e) => e.pkg.name === p.name && e.pkg.version === p.version && e.pkg.path === p.path,
      );
      return {
        name: p.name,
        version: p.version,
        license: p.license,
        category: p.category,
        source: p.source,
        relation: p.relation,
        path: p.path,
        ...(evaln ? { status: evaln.status, reason: evaln.reason } : {}),
      };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

/** Markdown license inventory for the `report` command. */
export function renderMarkdownReport(packages: PackageRecord[]): string {
  const counts = summarizeCategories(packages);
  const lines: string[] = [];
  lines.push("# License Inventory");
  lines.push("");
  lines.push(`Total dependencies scanned: **${packages.length}**`);
  lines.push("");
  lines.push("## Summary by category");
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("| --- | --- |");
  for (const [cat, n] of Object.entries(counts)) {
    if (n > 0) lines.push(`| ${cat} | ${n} |`);
  }
  lines.push("");
  lines.push("## Dependencies");
  lines.push("");
  lines.push("| Package | Version | License | Category | Source |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const p of packages) {
    const license = p.license ? mdEscape(p.license) : "_(none)_";
    lines.push(
      `| ${mdEscape(p.name)} | ${mdEscape(p.version)} | ${license} | ${p.category} | ${p.source} |`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`> ${DISCLAIMER}`);
  lines.push("");
  return lines.join("\n");
}

/** Escape characters that would break a Markdown table cell. */
function mdEscape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

/** Render the `missing` command output (packages with no detectable license). */
export function renderMissing(packages: PackageRecord[], color: boolean): string {
  if (packages.length === 0) {
    return colorize("No packages with missing licenses. 🎉", "32", color);
  }
  const header = ["PACKAGE", "VERSION", "SOURCE", "PATH"];
  const rows = packages.map((p) => [p.name, p.version, p.source, p.path]);
  return [
    renderTable(header, rows),
    "",
    `${packages.length} package(s) with no detectable license.`,
    "",
    DISCLAIMER,
  ].join("\n");
}
