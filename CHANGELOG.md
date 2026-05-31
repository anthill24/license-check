# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-31

Initial release.

### Added

- `scan` command: walk the installed dependency tree and print a table of
  package → license → category (`--format table|json`).
- `scan --policy <file>`: evaluate dependencies against a policy and exit `1` on
  violations, with a `STATUS` column and a violation list on stderr.
- `report` command: generate a Markdown (or JSON) license inventory suitable for
  a docs page or release attachment.
- `missing` command: list dependencies with no detectable license.
- Bundled SPDX id → category map covering common npm licenses, grouped as
  permissive / weak-copyleft / strong-copyleft / network-copyleft / proprietary,
  with `unknown` as the fallthrough.
- Pragmatic SPDX expression handling for `A OR B`, `A AND B`, and a single
  wrapping pair of parentheses.
- License detection from `package.json` (`license` string, deprecated object and
  array forms) and from bundled `LICENSE`/`COPYING` files via signature matching.
- Node-style dependency resolution for hoisted and nested `node_modules`, with
  scoped-package and deduplication support.
- `.licensecheckrc.json` policy/config: `allowedCategories`, `allow`, `deny`,
  per-package `overrides` (by name or `name@version`), `allowUnknown`, and
  `include` scope selection. Auto-detected from the scanned project.
- GitHub Action (`action.yml`): writes a Markdown inventory to
  `$GITHUB_STEP_SUMMARY` and fails the build on policy violations.
- Programmatic API exported from the package entry point.
- Offline operation by default and zero runtime dependencies.

### Notes

- This tool is informational and **not legal advice**. License categories are a
  heuristic triage aid.

[Unreleased]: https://github.com/anthill24/license-check/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anthill24/license-check/releases/tag/v0.1.0
