/**
 * Walk an npm project's installed dependency tree and produce one
 * {@link PackageRecord} per resolved package.
 *
 * Resolution mirrors Node's algorithm for a hoisted `node_modules` layout: to
 * resolve a dependency `name` required from directory `fromDir`, we look for
 * `<dir>/node_modules/<name>` walking up from `fromDir` to the project root.
 * This handles both flat (hoisted) and nested installs.
 *
 * Everything is read from the local filesystem — no network access.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectLicense, readManifest, type RawManifest } from "./detect.js";
import { categoryOfExpression } from "./spdx.js";
import type { PackageRecord, WalkOptions } from "./types.js";

export const DEFAULT_WALK_OPTIONS: WalkOptions = {
  includeDependencies: true,
  includeDevDependencies: false,
  includeOptionalDependencies: true,
  includePeerDependencies: false,
};

/** Collect the set of direct dependency names from a root manifest. */
function directDependencyNames(manifest: RawManifest & Record<string, unknown>, options: WalkOptions): Set<string> {
  const names = new Set<string>();
  const add = (field: string): void => {
    const deps = manifest[field];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps as Record<string, unknown>)) names.add(name);
    }
  };
  if (options.includeDependencies) add("dependencies");
  if (options.includeDevDependencies) add("devDependencies");
  if (options.includeOptionalDependencies) add("optionalDependencies");
  if (options.includePeerDependencies) add("peerDependencies");
  return names;
}

/** Transitive dependency names — dev deps are never followed transitively. */
function transitiveDependencyNames(manifest: RawManifest & Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "optionalDependencies"]) {
    const deps = manifest[field];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps as Record<string, unknown>)) names.add(name);
    }
  }
  return names;
}

/**
 * Resolve a dependency `name` starting from `fromDir`, walking parent
 * directories up to (and including) `rootDir`. Returns the package directory or
 * `null` if not installed.
 */
function resolvePackageDir(name: string, fromDir: string, rootDir: string): string | null {
  let dir = fromDir;
  // Walk up until we pass the project root.
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    if (dir === rootDir) break;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

/** Resolve the canonical real path so symlinked installs dedupe correctly. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Walk the dependency tree rooted at `rootDir` (which must contain a
 * `package.json`). Returns one record per unique resolved package, sorted by
 * name then version.
 *
 * @throws if `rootDir/package.json` cannot be read.
 */
export function walkDependencies(
  rootDir: string,
  options: WalkOptions = DEFAULT_WALK_OPTIONS,
): PackageRecord[] {
  const rootManifest = readManifest(rootDir) as (RawManifest & Record<string, unknown>) | null;
  if (!rootManifest) {
    throw new Error(`No readable package.json found in ${rootDir}`);
  }

  const records = new Map<string, PackageRecord>(); // keyed by canonical path
  const visited = new Set<string>(); // canonical paths already queued/seen

  interface QueueItem {
    name: string;
    fromDir: string;
    relation: "direct" | "transitive";
  }

  const queue: QueueItem[] = [];
  for (const name of directDependencyNames(rootManifest, options)) {
    queue.push({ name, fromDir: rootDir, relation: "direct" });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const dir = resolvePackageDir(item.name, item.fromDir, rootDir);
    if (!dir) continue; // declared but not installed — skip silently

    const real = canonical(dir);
    if (visited.has(real)) continue;
    visited.add(real);

    const manifest = readManifest(dir) as (RawManifest & Record<string, unknown>) | null;
    const detection = detectLicense(dir, manifest);
    const version =
      manifest && typeof manifest.version === "string" ? manifest.version : "unknown";
    const name = manifest && typeof manifest.name === "string" ? manifest.name : item.name;

    records.set(real, {
      name,
      version,
      path: dir,
      license: detection.license,
      source: detection.source,
      category: categoryOfExpression(detection.license),
      relation: item.relation,
    });

    // Enqueue this package's runtime dependencies as transitive.
    if (manifest) {
      for (const depName of transitiveDependencyNames(manifest)) {
        queue.push({ name: depName, fromDir: dir, relation: "transitive" });
      }
    }
  }

  return [...records.values()].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  });
}
