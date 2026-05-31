import { describe, it, expect } from "vitest";
import {
  SPDX_CATEGORIES,
  categoryOfId,
  categoryOfExpression,
  normalizeLicenseId,
  parseSpdxExpression,
  licenseIdsOf,
} from "../src/spdx.js";

describe("normalizeLicenseId", () => {
  it("returns canonical ids unchanged", () => {
    expect(normalizeLicenseId("MIT")).toBe("MIT");
    expect(normalizeLicenseId("Apache-2.0")).toBe("Apache-2.0");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeLicenseId("  MIT  ")).toBe("MIT");
  });

  it("maps deprecated GPL ids to -only by convention", () => {
    expect(normalizeLicenseId("GPL-3.0")).toBe("GPL-3.0-only");
    expect(normalizeLicenseId("GPL-2.0")).toBe("GPL-2.0-only");
    expect(normalizeLicenseId("LGPL-2.1")).toBe("LGPL-2.1-only");
    expect(normalizeLicenseId("AGPL-3.0")).toBe("AGPL-3.0-only");
  });

  it("maps the + suffix to -or-later for GPL-family aliases", () => {
    expect(normalizeLicenseId("GPL-3.0+")).toBe("GPL-3.0-or-later");
    expect(normalizeLicenseId("LGPL-2.1+")).toBe("LGPL-2.1-or-later");
  });

  it("strips a trailing + on other licenses, falling back to the base id", () => {
    expect(normalizeLicenseId("MIT+")).toBe("MIT");
    expect(normalizeLicenseId("BSD-3-Clause+")).toBe("BSD-3-Clause");
    expect(normalizeLicenseId("Zlib+")).toBe("Zlib");
  });

  it("strips a WITH exception suffix", () => {
    expect(normalizeLicenseId("Apache-2.0 WITH LLVM-exception")).toBe("Apache-2.0");
    expect(normalizeLicenseId("GPL-2.0-only WITH Classpath-exception-2.0")).toBe(
      "GPL-2.0-only",
    );
  });

  it("matches case-insensitively against the canonical map", () => {
    expect(normalizeLicenseId("mit")).toBe("MIT");
    expect(normalizeLicenseId("apache-2.0")).toBe("Apache-2.0");
  });

  it("resolves common free-text spellings", () => {
    expect(normalizeLicenseId("Apache 2.0")).toBe("Apache-2.0");
    expect(normalizeLicenseId("Public Domain")).toBe("Unlicense");
    expect(normalizeLicenseId("New BSD")).toBe("BSD-3-Clause");
  });

  it("leaves unknown ids untouched", () => {
    expect(normalizeLicenseId("Frobnicate-1.0")).toBe("Frobnicate-1.0");
  });
});

describe("categoryOfId", () => {
  it("categorises permissive licenses", () => {
    expect(categoryOfId("MIT")).toBe("permissive");
    expect(categoryOfId("Apache-2.0")).toBe("permissive");
    expect(categoryOfId("ISC")).toBe("permissive");
    expect(categoryOfId("BSD-3-Clause")).toBe("permissive");
  });

  it("categorises weak copyleft", () => {
    expect(categoryOfId("LGPL-3.0-only")).toBe("weak-copyleft");
    expect(categoryOfId("MPL-2.0")).toBe("weak-copyleft");
    expect(categoryOfId("EPL-2.0")).toBe("weak-copyleft");
  });

  it("categorises strong copyleft", () => {
    expect(categoryOfId("GPL-3.0-only")).toBe("strong-copyleft");
    expect(categoryOfId("GPL-2.0-or-later")).toBe("strong-copyleft");
  });

  it("categorises network copyleft", () => {
    expect(categoryOfId("AGPL-3.0-only")).toBe("network-copyleft");
    expect(categoryOfId("SSPL-1.0")).toBe("network-copyleft");
  });

  it("treats UNLICENSED and custom markers as proprietary", () => {
    expect(categoryOfId("UNLICENSED")).toBe("proprietary");
    expect(categoryOfId("SEE LICENSE IN LICENSE.txt")).toBe("proprietary");
    expect(categoryOfId("LicenseRef-Acme-Commercial")).toBe("proprietary");
  });

  it("returns unknown for unrecognised ids", () => {
    expect(categoryOfId("Frobnicate-1.0")).toBe("unknown");
    expect(categoryOfId("")).toBe("unknown");
  });

  it("categorises a trailing-+ license by its base", () => {
    expect(categoryOfId("MIT+")).toBe("permissive");
    expect(categoryOfId("Apache-2.0+")).toBe("permissive");
    // And it must not poison compound expressions via the unknown rank.
    expect(categoryOfExpression("MIT+ AND GPL-3.0-only")).toBe("strong-copyleft");
  });

  it("applies normalisation before lookup", () => {
    expect(categoryOfId("GPL-3.0")).toBe("strong-copyleft");
  });
});

describe("parseSpdxExpression", () => {
  it("parses a single license", () => {
    expect(parseSpdxExpression("MIT")).toEqual({ op: "LICENSE", id: "MIT" });
  });

  it("parses OR expressions", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0")).toEqual({
      op: "OR",
      parts: [
        { op: "LICENSE", id: "MIT" },
        { op: "LICENSE", id: "Apache-2.0" },
      ],
    });
  });

  it("parses AND expressions", () => {
    expect(parseSpdxExpression("MIT AND BSD-3-Clause")).toEqual({
      op: "AND",
      parts: [
        { op: "LICENSE", id: "MIT" },
        { op: "LICENSE", id: "BSD-3-Clause" },
      ],
    });
  });

  it("strips a single wrapping pair of parentheses", () => {
    expect(parseSpdxExpression("(MIT OR Apache-2.0)")).toEqual({
      op: "OR",
      parts: [
        { op: "LICENSE", id: "MIT" },
        { op: "LICENSE", id: "Apache-2.0" },
      ],
    });
  });

  it("gives OR looser precedence than AND", () => {
    const node = parseSpdxExpression("MIT AND BSD-3-Clause OR Apache-2.0");
    expect(node.op).toBe("OR");
  });

  it("does not split operators nested in parentheses", () => {
    expect(parseSpdxExpression("(MIT OR ISC) AND BSD-3-Clause")).toEqual({
      op: "AND",
      parts: [
        {
          op: "OR",
          parts: [
            { op: "LICENSE", id: "MIT" },
            { op: "LICENSE", id: "ISC" },
          ],
        },
        { op: "LICENSE", id: "BSD-3-Clause" },
      ],
    });
  });
});

describe("categoryOfExpression", () => {
  it("returns unknown for null/empty", () => {
    expect(categoryOfExpression(null)).toBe("unknown");
    expect(categoryOfExpression("")).toBe("unknown");
    expect(categoryOfExpression("   ")).toBe("unknown");
  });

  it("picks the least restrictive option for OR", () => {
    expect(categoryOfExpression("(GPL-3.0-only OR MIT)")).toBe("permissive");
    expect(categoryOfExpression("AGPL-3.0-only OR Apache-2.0")).toBe("permissive");
  });

  it("picks the most restrictive option for AND", () => {
    expect(categoryOfExpression("MIT AND GPL-3.0-only")).toBe("strong-copyleft");
    expect(categoryOfExpression("MIT AND Apache-2.0")).toBe("permissive");
  });

  it("handles single ids", () => {
    expect(categoryOfExpression("MPL-2.0")).toBe("weak-copyleft");
  });
});

describe("licenseIdsOf", () => {
  it("collects ids from compound expressions", () => {
    expect(licenseIdsOf("(MIT OR Apache-2.0)").sort()).toEqual(["Apache-2.0", "MIT"]);
    expect(licenseIdsOf("MIT AND BSD-3-Clause").sort()).toEqual(["BSD-3-Clause", "MIT"]);
  });

  it("returns an empty array for null", () => {
    expect(licenseIdsOf(null)).toEqual([]);
  });
});

describe("SPDX_CATEGORIES map", () => {
  it("contains the common npm licenses", () => {
    for (const id of ["MIT", "Apache-2.0", "ISC", "GPL-3.0-only", "AGPL-3.0-only", "MPL-2.0"]) {
      expect(SPDX_CATEGORIES[id]).toBeDefined();
    }
  });

  it("only uses valid category values", () => {
    const valid = new Set([
      "permissive",
      "weak-copyleft",
      "strong-copyleft",
      "network-copyleft",
      "proprietary",
      "unknown",
    ]);
    for (const cat of Object.values(SPDX_CATEGORIES)) {
      expect(valid.has(cat)).toBe(true);
    }
  });
});
