import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to a fixture under test/fixtures. */
export function fixture(...parts: string[]): string {
  return join(here, "fixtures", ...parts);
}

export const SAMPLE_PROJECT = fixture("sample-project");
export const AUTO_PROJECT = fixture("auto-project");
export const EMPTY_PROJECT = fixture("empty-project");
