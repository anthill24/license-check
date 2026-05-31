import { describe, it, expect } from "vitest";
import {
  validatePolicy,
  loadPolicy,
  evaluatePackage,
  evaluateAll,
} from "../src/policy.js";
import type { PackageRecord, PolicyConfig } from "../src/types.js";
import { categoryOfExpression } from "../src/spdx.js";
import { fixture } from "./helpers.js";

/** Build a minimal PackageRecord for a given license expression. */
function pkg(name: string, license: string | null, version = "1.0.0"): PackageRecord {
  return {
    name,
    version,
    path: `/fake/${name}`,
    license,
    source: license ? "package.json:license" : "none",
    category: categoryOfExpression(license),
    relation: "direct",
  };
}

describe("validatePolicy", () => {
  it("accepts an empty object", () => {
    expect(validatePolicy({})).toEqual({});
  });

  it("accepts a full valid policy", () => {
    const input = {
      allowedCategories: ["permissive", "weak-copyleft"],
      allow: ["MPL-2.0"],
      deny: ["GPL-3.0-only"],
      overrides: { "some-pkg": "MIT" },
      allowUnknown: true,
      include: { devDependencies: true },
    };
    expect(validatePolicy(input)).toEqual(input);
  });

  it("rejects non-objects", () => {
    expect(() => validatePolicy(null)).toThrow();
    expect(() => validatePolicy([])).toThrow();
    expect(() => validatePolicy("nope")).toThrow();
  });

  it("rejects invalid categories", () => {
    expect(() => validatePolicy({ allowedCategories: ["banana"] })).toThrow(/Invalid category/);
  });

  it("rejects non-array allow/deny", () => {
    expect(() => validatePolicy({ allow: "MIT" })).toThrow();
    expect(() => validatePolicy({ deny: [1, 2] })).toThrow();
  });

  it("rejects a non-boolean allowUnknown", () => {
    expect(() => validatePolicy({ allowUnknown: "yes" })).toThrow();
  });

  it("rejects non-string override values", () => {
    expect(() => validatePolicy({ overrides: { lodash: 123 } })).toThrow(/must be an SPDX id string/);
    expect(() => validatePolicy({ overrides: { lodash: ["MIT"] } })).toThrow();
    expect(() => validatePolicy({ overrides: { lodash: null } })).toThrow();
  });

  it("rejects unknown keys in include", () => {
    expect(() => validatePolicy({ include: { typoDeps: true } })).toThrow(/Unknown key in `include`/);
  });

  it("rejects non-boolean include values", () => {
    expect(() => validatePolicy({ include: { dependencies: "yes" } })).toThrow(/must be a boolean/);
  });
});

describe("loadPolicy", () => {
  it("loads a valid policy file", () => {
    const policy = loadPolicy(fixture("policies", "permissive-only.json"));
    expect(policy.allowedCategories).toEqual(["permissive"]);
  });

  it("throws a helpful error for invalid JSON", () => {
    expect(() => loadPolicy(fixture("policies", "invalid.json"))).toThrow(/not valid JSON/);
  });

  it("throws for a missing file", () => {
    expect(() => loadPolicy(fixture("policies", "nope.json"))).toThrow(/Could not read/);
  });
});

describe("evaluatePackage — categories", () => {
  const permissiveOnly: PolicyConfig = { allowedCategories: ["permissive"] };

  it("allows a permissive license under a permissive-only policy", () => {
    expect(evaluatePackage(pkg("a", "MIT"), permissiveOnly).status).toBe("allowed");
  });

  it("denies copyleft under a permissive-only policy", () => {
    const e = evaluatePackage(pkg("a", "GPL-3.0-only"), permissiveOnly);
    expect(e.status).toBe("denied");
    expect(e.reason).toMatch(/not permitted/);
  });

  it("allows everything when no allowedCategories are set", () => {
    expect(evaluatePackage(pkg("a", "GPL-3.0-only"), {}).status).toBe("allowed");
  });
});

describe("evaluatePackage — allow/deny lists", () => {
  it("deny overrides an otherwise-allowed category", () => {
    const policy: PolicyConfig = { allowedCategories: ["permissive"], deny: ["MIT"] };
    expect(evaluatePackage(pkg("a", "MIT"), policy).status).toBe("denied");
  });

  it("allow overrides a disallowed category", () => {
    const policy: PolicyConfig = { allowedCategories: ["permissive"], allow: ["MPL-2.0"] };
    expect(evaluatePackage(pkg("a", "MPL-2.0"), policy).status).toBe("allowed");
  });

  it("deny takes precedence over allow", () => {
    const policy: PolicyConfig = { allow: ["MIT"], deny: ["MIT"] };
    expect(evaluatePackage(pkg("a", "MIT"), policy).status).toBe("denied");
  });

  it("normalises ids in allow/deny", () => {
    const policy: PolicyConfig = { deny: ["GPL-3.0"] };
    expect(evaluatePackage(pkg("a", "GPL-3.0-only"), policy).status).toBe("denied");
  });
});

describe("evaluatePackage — compound expressions", () => {
  const permissiveOnly: PolicyConfig = { allowedCategories: ["permissive"] };

  it("OR is allowed when any operand is allowed", () => {
    expect(evaluatePackage(pkg("a", "(GPL-3.0-only OR MIT)"), permissiveOnly).status).toBe(
      "allowed",
    );
  });

  it("OR is denied when no operand is acceptable", () => {
    expect(evaluatePackage(pkg("a", "(GPL-3.0-only OR AGPL-3.0-only)"), permissiveOnly).status).toBe(
      "denied",
    );
  });

  it("AND requires every operand to be allowed", () => {
    expect(evaluatePackage(pkg("a", "MIT AND GPL-3.0-only"), permissiveOnly).status).toBe(
      "denied",
    );
    expect(evaluatePackage(pkg("a", "MIT AND ISC"), permissiveOnly).status).toBe("allowed");
  });

  it("OR with a denied operand still passes via the other operand", () => {
    const policy: PolicyConfig = { allowedCategories: ["permissive"], deny: ["GPL-3.0-only"] };
    expect(evaluatePackage(pkg("a", "(GPL-3.0-only OR MIT)"), policy).status).toBe("allowed");
  });
});

describe("evaluatePackage — unknown / missing", () => {
  it("flags a missing license as unknown by default", () => {
    expect(evaluatePackage(pkg("a", null), {}).status).toBe("unknown");
  });

  it("allows a missing license when allowUnknown is set", () => {
    expect(evaluatePackage(pkg("a", null), { allowUnknown: true }).status).toBe("allowed");
  });

  it("flags an unrecognised license id as unknown", () => {
    expect(evaluatePackage(pkg("a", "Frobnicate-1.0"), {}).status).toBe("unknown");
  });

  it("allows an unrecognised id when allowUnknown is set", () => {
    expect(evaluatePackage(pkg("a", "Frobnicate-1.0"), { allowUnknown: true }).status).toBe(
      "allowed",
    );
  });
});

describe("evaluatePackage — overrides", () => {
  it("applies a per-name override", () => {
    const policy: PolicyConfig = {
      allowedCategories: ["permissive"],
      overrides: { "gpl-pkg": "MIT" },
    };
    expect(evaluatePackage(pkg("gpl-pkg", "GPL-3.0-only"), policy).status).toBe("allowed");
  });

  it("applies a name@version override", () => {
    const policy: PolicyConfig = {
      allowedCategories: ["permissive"],
      overrides: { "gpl-pkg@3.0.1": "MIT" },
    };
    expect(evaluatePackage(pkg("gpl-pkg", "GPL-3.0-only", "3.0.1"), policy).status).toBe("allowed");
    // A different version is unaffected.
    expect(evaluatePackage(pkg("gpl-pkg", "GPL-3.0-only", "2.0.0"), policy).status).toBe("denied");
  });

  it("prefers a versioned override over a name override", () => {
    const policy: PolicyConfig = {
      allowedCategories: ["permissive"],
      overrides: { "gpl-pkg": "GPL-3.0-only", "gpl-pkg@3.0.1": "MIT" },
    };
    expect(evaluatePackage(pkg("gpl-pkg", "GPL-3.0-only", "3.0.1"), policy).status).toBe("allowed");
  });
});

describe("evaluateAll", () => {
  it("partitions violations from allowed packages", () => {
    const packages = [pkg("a", "MIT"), pkg("b", "GPL-3.0-only"), pkg("c", null)];
    const policy: PolicyConfig = { allowedCategories: ["permissive"] };
    const { evaluations, violations } = evaluateAll(packages, policy);
    expect(evaluations).toHaveLength(3);
    expect(violations.map((v) => v.pkg.name).sort()).toEqual(["b", "c"]);
  });
});
