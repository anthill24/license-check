import { describe, it, expect } from "vitest";
import { walkDependencies, DEFAULT_WALK_OPTIONS } from "../src/walk.js";
import type { PackageRecord, WalkOptions } from "../src/types.js";
import { SAMPLE_PROJECT, EMPTY_PROJECT } from "./helpers.js";

function byName(pkgs: PackageRecord[]): Map<string, PackageRecord> {
  return new Map(pkgs.map((p) => [p.name, p]));
}

describe("walkDependencies", () => {
  it("throws when the root has no package.json", () => {
    expect(() => walkDependencies("/no/such/dir")).toThrow(/No readable package\.json/);
  });

  it("returns an empty list for a project with no dependencies", () => {
    expect(walkDependencies(EMPTY_PROJECT)).toEqual([]);
  });

  it("walks direct production dependencies", () => {
    const pkgs = walkDependencies(SAMPLE_PROJECT);
    const map = byName(pkgs);
    expect(map.has("permissive-mit")).toBe(true);
    expect(map.has("apache-pkg")).toBe(true);
    expect(map.has("dual-pkg")).toBe(true);
  });

  it("excludes devDependencies by default", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.has("dev-only-gpl")).toBe(false);
  });

  it("includes devDependencies when requested", () => {
    const options: WalkOptions = { ...DEFAULT_WALK_OPTIONS, includeDevDependencies: true };
    const map = byName(walkDependencies(SAMPLE_PROJECT, options));
    expect(map.has("dev-only-gpl")).toBe(true);
  });

  it("includes optionalDependencies by default and can exclude them", () => {
    expect(byName(walkDependencies(SAMPLE_PROJECT)).has("optional-isc-pkg")).toBe(true);
    const options: WalkOptions = { ...DEFAULT_WALK_OPTIONS, includeOptionalDependencies: false };
    expect(byName(walkDependencies(SAMPLE_PROJECT, options)).has("optional-isc-pkg")).toBe(false);
  });

  it("records detected licenses and categories", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("permissive-mit")?.license).toBe("MIT");
    expect(map.get("permissive-mit")?.category).toBe("permissive");
    expect(map.get("gpl-pkg")?.category).toBe("strong-copyleft");
    expect(map.get("agpl-pkg")?.category).toBe("network-copyleft");
    expect(map.get("mpl-pkg")?.category).toBe("weak-copyleft");
    expect(map.get("unlicensed-pkg")?.category).toBe("proprietary");
    expect(map.get("unknown-license-pkg")?.category).toBe("unknown");
  });

  it("captures package versions", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("permissive-mit")?.version).toBe("1.2.3");
    expect(map.get("apache-pkg")?.version).toBe("2.1.0");
  });

  it("resolves scoped packages", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("@scope/scoped-pkg")?.license).toBe("ISC");
  });

  it("resolves nested (non-hoisted) dependencies", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    // nested-dep only exists under parent-with-nested/node_modules.
    expect(map.get("nested-dep")?.license).toBe("BSD-2-Clause");
    expect(map.get("nested-dep")?.relation).toBe("transitive");
  });

  it("marks direct vs transitive relations", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("permissive-mit")?.relation).toBe("direct");
    expect(map.get("nested-dep")?.relation).toBe("transitive");
  });

  it("deduplicates packages reached by multiple paths", () => {
    // permissive-mit is both a direct dep and a dep of parent-with-nested.
    const pkgs = walkDependencies(SAMPLE_PROJECT);
    expect(pkgs.filter((p) => p.name === "permissive-mit")).toHaveLength(1);
  });

  it("detects a license from a bundled LICENSE file during the walk", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("license-file-only")?.license).toBe("MIT");
    expect(map.get("license-file-only")?.source).toBe("license-file");
  });

  it("reports null license for packages with none", () => {
    const map = byName(walkDependencies(SAMPLE_PROJECT));
    expect(map.get("no-license-pkg")?.license).toBeNull();
    expect(map.get("no-license-pkg")?.source).toBe("none");
  });

  it("returns records sorted by name", () => {
    const pkgs = walkDependencies(SAMPLE_PROJECT);
    const names = pkgs.map((p) => p.name);
    expect(names).toEqual([...names].sort());
  });
});
