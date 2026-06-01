# license-check

> Scan an npm project's dependency tree, identify each dependency's license, and flag policy violations and missing licenses — offline, SPDX-aware, zero runtime dependencies.

`license-check` is a small CLI and GitHub Action for the npm ecosystem. It reads
license information straight from your installed `node_modules` and tells you:

1. **What licenses your dependencies use**, grouped into coarse categories
   (permissive / weak-copyleft / strong-copyleft / network-copyleft /
   proprietary / unknown).
2. **Whether any dependency violates a policy** you define (allow/deny by SPDX
   id or category).
3. **Which dependencies have no detectable license** at all.

> [!IMPORTANT]
> **license-check is informational tooling, not legal advice.** License
> categorisation is heuristic and may be incomplete or wrong. It is not a
> substitute for reading the actual license texts or consulting a qualified
> professional before making compliance or distribution decisions. The category
> labels are a triage aid, nothing more.

---

## The problem it solves

A typical Node project pulls in hundreds of transitive dependencies. Any one of
them might be GPL, AGPL, or have no license at all — which can be a real problem
if you ship proprietary software or have obligations to your own users. Finding
those needles by hand is impractical. `license-check` gives you a fast,
reproducible, **offline** inventory and a CI gate so a surprising license can't
sneak in unnoticed.

- **Offline by default.** It reads `node_modules/*/package.json` and bundled
  `LICENSE` files. It never phones home or hits a network registry.
- **Zero runtime dependencies.** The tool itself adds no packages to your
  supply chain (and its own license report is trivially clean).
- **SPDX-aware.** Understands SPDX identifiers and simple `OR`/`AND`
  expressions, plus the deprecated `license`/`licenses` object forms still found
  in the wild.

## Install

Requires **Node.js 20+**.

```bash
# From source (until/unless published to a registry):
git clone https://github.com/anthill24/license-check.git
cd license-check
npm install
npm run build
npm link        # exposes the `license-check` binary on your PATH
```

Then, from any npm project that has its dependencies installed:

```bash
license-check scan
```

## Usage

```text
license-check <command> [options]

COMMANDS
  scan       Walk dependencies and print a license table
  report     Generate a Markdown (or JSON) license inventory
  missing    List dependencies with no detectable license

OPTIONS
  --dir <path>        Project root to scan (default: current directory)
  --policy <file>     Policy/config file (default: auto-detect .licensecheckrc.json)
  --fail-on <cats>    Comma-separated categories to fail on, without a policy file
  --format <fmt>      Output format (table|json for scan/missing; markdown|json for report)
  --include-dev       Include devDependencies in the walk
  --no-optional       Exclude optionalDependencies from the walk
  --allow-unknown     Do not treat unknown/missing licenses as violations
  --no-color          Disable ANSI colour
  -h, --help          Show help
  -v, --version       Print the version

EXIT CODES
  0  success, no policy violations
  1  policy violations found (or, for `missing`, missing licenses found)
  2  usage or runtime error
```

### `scan` — table of package → license → category

```bash
license-check scan
```

```text
PACKAGE                VERSION  LICENSE                CATEGORY
---------------------  -------  ---------------------  ----------------
apache-pkg             2.1.0    Apache-2.0             permissive
dual-pkg               1.0.0    (MIT OR Apache-2.0)    permissive
gpl-pkg                3.0.1    GPL-3.0-only           strong-copyleft
mpl-pkg                2.0.0    MPL-2.0                weak-copyleft
no-license-pkg         1.0.0    (none)                 unknown
...
```

### `scan --policy` — fail the build on a violation

```bash
license-check scan --policy .licensecheckrc.json
```

When a policy is active, a `STATUS` column is added and the process exits `1`
if any dependency violates the policy, listing each violation on stderr. This is
what makes it useful in CI.

### `scan --fail-on` — gate without a policy file

For a quick CI gate you don't need a policy file at all:

```bash
license-check scan --fail-on strong-copyleft,network-copyleft
```

Without a policy file, this fails (exit `1`) only for dependencies in the listed
categories. It is a *precise* gate: unknown/missing licenses are not failed on
unless you add `unknown` to the list. Valid categories: `permissive`,
`weak-copyleft`, `strong-copyleft`, `network-copyleft`, `proprietary`,
`unknown`. `--fail-on` composes with a `--policy` file, further restricting it
while preserving the policy's `allowUnknown` behavior.

### `scan --format json` — machine-readable

```bash
license-check scan --format json
```

```json
{
  "disclaimer": "license-check provides informational output ...",
  "summary": { "total": 42, "categories": { "permissive": 40, "weak-copyleft": 2 } },
  "packages": [
    { "name": "lodash", "version": "4.17.21", "license": "MIT", "category": "permissive", "source": "package.json:license", "relation": "transitive" }
  ]
}
```

### `report --format markdown` — an inventory for docs or a release

```bash
license-check report --format markdown > LICENSES.md
```

Produces a Markdown document with a category summary table and a full
dependency table — suitable for a docs page or a release attachment.

### `missing` — dependencies with no detectable license

```bash
license-check missing
```

Lists every dependency where no license could be found in `package.json` or a
bundled `LICENSE` file. Exits `1` if any are found, so it can be used as a
lightweight gate on its own.

## Policy / configuration file

`license-check` looks for `.licensecheckrc.json` in the scanned project (or pass
`--policy <file>`). Every field is optional.

```json
{
  "allowedCategories": ["permissive", "weak-copyleft"],
  "allow": ["MPL-2.0"],
  "deny": ["GPL-3.0-only", "AGPL-3.0-only"],
  "overrides": {
    "some-internal-pkg": "MIT",
    "mislabeled-pkg@1.2.3": "BSD-3-Clause"
  },
  "allowUnknown": false,
  "include": {
    "dependencies": true,
    "devDependencies": false,
    "optionalDependencies": true,
    "peerDependencies": false
  }
}
```

| Field | Meaning |
| --- | --- |
| `allowedCategories` | Categories permitted. If omitted, **all** categories are permitted (report-only). |
| `allow` | SPDX ids always permitted, overriding category rules. |
| `deny` | SPDX ids always forbidden, overriding `allow` and category rules. |
| `overrides` | Per-package license override, keyed by `name` or `name@version`. Useful for mislabeled or internal packages. |
| `allowUnknown` | When `true`, unknown/missing licenses are not violations. Default `false`. |
| `include` | Which dependency scopes to walk. |

**Evaluation rules**

- A bare license id is allowed when it is not in `deny` **and** (it is in
  `allow` **or** its category is allowed).
- `deny` beats `allow` beats category.
- `A OR B` passes if **either** operand passes (you may pick the acceptable one).
- `A AND B` passes only if **every** operand passes.
- A missing or unrecognised license is `unknown`, which is a violation unless
  `allowUnknown` is set.

See [`.licensecheckrc.example.json`](./.licensecheckrc.example.json).

## License categories

| Category | Examples | Notes |
| --- | --- | --- |
| `permissive` | MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense | Minimal restrictions. |
| `weak-copyleft` | LGPL, MPL-2.0, EPL-2.0, CDDL | File/library-level copyleft. |
| `strong-copyleft` | GPL-2.0, GPL-3.0, OSL-3.0 | Project-level copyleft. |
| `network-copyleft` | AGPL-3.0, SSPL-1.0, CPAL | Copyleft triggered by network/SaaS use. |
| `proprietary` | UNLICENSED, `SEE LICENSE IN ...`, `LicenseRef-*` | No standard grant; review required. |
| `unknown` | anything not in the bundled map, or no license found | Treated as a violation by default. |

The bundled map lives in [`src/spdx.ts`](./src/spdx.ts) and is easy to audit and
extend. It is intentionally small and **not** exhaustive.

## GitHub Action

`license-check` ships an [`action.yml`](./action.yml). It writes a Markdown
license inventory to the job summary and fails the step on policy violations.

```yaml
name: License check
on: [push, pull_request]

jobs:
  licenses:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # Dependencies must be installed so the tool can read node_modules.
      - run: npm ci
      - uses: anthill24/license-check@v0.1.0
        with:
          policy: .licensecheckrc.json
          include-dev: "false"
          allow-unknown: "false"
          fail-on-violations: "true"
```

| Input | Default | Description |
| --- | --- | --- |
| `directory` | `.` | Project root to scan. |
| `policy` | `""` | Policy file path. Empty = auto-detect `.licensecheckrc.json`. |
| `include-dev` | `false` | Include devDependencies. |
| `allow-unknown` | `false` | Don't fail on unknown/missing licenses. |
| `fail-on-violations` | `true` | Fail the step on violations. |

Output `violations` holds the number of violations found.

## Programmatic API

```ts
import { walkDependencies, evaluateAll, loadPolicy } from "license-check";

const packages = walkDependencies(process.cwd());
const policy = loadPolicy(".licensecheckrc.json");
const { violations } = evaluateAll(packages, policy);
if (violations.length) process.exit(1);
```

## How detection works

For each resolved package, in order (first hit wins):

1. `package.json` `license` string (SPDX expression).
2. `package.json` `license` object form (deprecated `{ type, url }`).
3. `package.json` `licenses` array form (deprecated; multiple entries → `OR`).
4. A bundled `LICENSE`/`COPYING` file, matched against a small set of
   well-known license signatures.

Dependency resolution mirrors Node's algorithm for hoisted **and** nested
`node_modules` layouts. Resolution is offline and reads only the local
filesystem.

## Limitations

- npm-only for now (reads `node_modules`). pnpm's symlinked store and Yarn PnP
  are not yet supported — see the roadmap.
- The SPDX expression parser is pragmatic: it handles single ids, `A OR B`,
  `A AND B`, and a single wrapping pair of parentheses, but not arbitrarily
  nested/precedence-mixed expressions or `WITH` exception semantics beyond
  categorising by the base license.
- The bundled category map is small and opinionated, not exhaustive.
- License-file content matching covers common licenses only.

## Maintenance status

Early-stage (**v0.1.0**), maintained on a best-effort basis. Issues and PRs are
welcome. There is **no claim** of production hardening or wide adoption — treat
it as a useful starting point and verify its output for anything that matters.

## Roadmap

- pnpm workspace / symlinked `node_modules` support.
- Full SPDX expression parsing (nested precedence, `WITH` exceptions, `+`).
- More licenses in the category map and more license-file signatures.
- Per-dependency-path tracing (show *why* a package is included).
- Additional ecosystems beyond npm.

See the [open issues](https://github.com/anthill24/license-check/issues) for the
current list.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: `npm install`, write a
failing test, make it pass, keep `npm run lint && npm run typecheck && npm test`
green.

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities. Note that
`license-check` does no network I/O and executes no dependency code — it only
reads files.

## License

[MIT](./LICENSE) © anthill24
