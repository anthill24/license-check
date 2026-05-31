import { describe, it, expect } from "vitest";
import {
  renderScanTable,
  renderJson,
  renderMarkdownReport,
  renderMissing,
  summarizeCategories,
  DISCLAIMER,
} from "../src/format.js";
import { evaluateAll } from "../src/policy.js";
import { categoryOfExpression } from "../src/spdx.js";
import type { PackageRecord } from "../src/types.js";

function pkg(name: string, license: string | null): PackageRecord {
  return {
    name,
    version: "1.0.0",
    path: `/fake/${name}`,
    license,
    source: license ? "package.json:license" : "none",
    category: categoryOfExpression(license),
    relation: "direct",
  };
}

const PACKAGES = [pkg("a-mit", "MIT"), pkg("b-gpl", "GPL-3.0-only"), pkg("c-none", null)];

describe("summarizeCategories", () => {
  it("counts packages per category", () => {
    const counts = summarizeCategories(PACKAGES);
    expect(counts.permissive).toBe(1);
    expect(counts["strong-copyleft"]).toBe(1);
    expect(counts.unknown).toBe(1);
    expect(counts["weak-copyleft"]).toBe(0);
  });
});

describe("renderScanTable", () => {
  it("includes a header and every package name", () => {
    const out = renderScanTable(PACKAGES, { color: false });
    expect(out).toContain("PACKAGE");
    expect(out).toContain("a-mit");
    expect(out).toContain("b-gpl");
    expect(out).toContain("c-none");
    expect(out).toContain("(none)");
  });

  it("always appends the disclaimer", () => {
    expect(renderScanTable(PACKAGES, { color: false })).toContain(DISCLAIMER);
  });

  it("omits ANSI codes when color is disabled", () => {
    const out = renderScanTable(PACKAGES, { color: false });
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\[/);
  });

  it("emits ANSI codes when color is enabled", () => {
    const out = renderScanTable(PACKAGES, { color: true });
    // eslint-disable-next-line no-control-regex
    expect(out).toMatch(/\[/);
  });

  it("adds a STATUS column when evaluations are provided", () => {
    const { evaluations } = evaluateAll(PACKAGES, { allowedCategories: ["permissive"] });
    const out = renderScanTable(PACKAGES, { color: false, evaluations });
    expect(out).toContain("STATUS");
    expect(out).toContain("allowed");
    expect(out).toContain("denied");
  });
});

describe("renderJson", () => {
  it("produces valid JSON with summary and packages", () => {
    const parsed = JSON.parse(renderJson(PACKAGES));
    expect(parsed.summary.total).toBe(3);
    expect(parsed.summary.categories.permissive).toBe(1);
    expect(parsed.packages).toHaveLength(3);
    expect(parsed.disclaimer).toBe(DISCLAIMER);
  });

  it("includes status when evaluations are passed", () => {
    const { evaluations } = evaluateAll(PACKAGES, { allowedCategories: ["permissive"] });
    const parsed = JSON.parse(renderJson(PACKAGES, evaluations));
    expect(parsed.summary.violations).toBe(2);
    const gpl = parsed.packages.find((p: { name: string }) => p.name === "b-gpl");
    expect(gpl.status).toBe("denied");
  });
});

describe("renderMarkdownReport", () => {
  it("produces a Markdown table and summary", () => {
    const md = renderMarkdownReport(PACKAGES);
    expect(md).toContain("# License Inventory");
    expect(md).toContain("## Summary by category");
    expect(md).toContain("| Package | Version | License | Category | Source |");
    expect(md).toContain("a-mit");
    expect(md).toContain("_(none)_");
    expect(md).toContain(DISCLAIMER);
  });

  it("escapes pipe characters in license expressions", () => {
    const md = renderMarkdownReport([pkg("weird", "MIT | custom")]);
    expect(md).toContain("MIT \\| custom");
  });

  it("strips carriage returns and newlines from table cells", () => {
    const md = renderMarkdownReport([pkg("weird", "MIT\r\nOR custom")]);
    // No raw CR/LF should survive inside the rendered dependency row.
    const depRow = md.split("\n").find((l) => l.startsWith("| weird |"));
    expect(depRow).toBeDefined();
    expect(depRow).not.toMatch(/[\r]/);
    expect(depRow).toContain("MIT OR custom");
  });
});

describe("renderMissing", () => {
  it("lists packages with no license", () => {
    const out = renderMissing([pkg("c-none", null)], false);
    expect(out).toContain("c-none");
    expect(out).toContain("1 package(s) with no detectable license.");
  });

  it("reports a clean result when nothing is missing", () => {
    expect(renderMissing([], false)).toContain("No packages with missing licenses");
  });
});
