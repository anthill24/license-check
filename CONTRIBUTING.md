# Contributing to license-check

Thanks for your interest! This is an early-stage, best-effort project and
contributions are very welcome — bug reports, fixes, new license mappings, and
features from the [roadmap](./README.md#roadmap) especially.

## Ground rules

- **license-check is informational, not legal advice.** Keep user-facing copy
  consistent with that. Don't imply the tool makes legal/compliance decisions.
- **Offline-only core.** The scan path must not make network requests or run
  installed dependency code. It reads files, nothing more.
- **Zero runtime dependencies.** Adding to `dependencies` needs a strong
  justification; `devDependencies` are fine.
- Be respectful. See [our expectations](#code-of-conduct).

## Getting started

```bash
git clone https://github.com/anthill24/license-check.git
cd license-check
npm install
npm test
```

You'll need **Node.js 20+**.

## Development workflow

1. Create a feature branch off `main`.
2. Write a test first (we use [Vitest](https://vitest.dev/)). Reproduce the bug
   or specify the new behaviour.
3. Implement until the test passes.
4. Make sure everything is green:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

5. Open a pull request against `main` and fill in the template.

CI (lint + typecheck + tests + build) runs on Node 20 and 22 and must pass
before merge.

## Project layout

See [AGENTS.md](./AGENTS.md) for a module-by-module map of the codebase and the
conventions we follow. The short version:

- Core logic is small, pure, well-documented TypeScript in `src/`.
- `run(argv, io)` in `src/cli.ts` holds all CLI behaviour and is unit-tested
  directly — add command behaviour there.
- Tests and fixtures live in `test/`. Fixtures are real, committed files.

## Adding a license to the category map

1. Add the canonical SPDX id to `SPDX_CATEGORIES` in `src/spdx.ts`, grouped with
   its category.
2. If the license has a recognisable file header, add a signature to
   `SIGNATURES` in `src/detect.ts` (order matters — more specific first).
3. Add or extend a test in `test/spdx.test.ts` / `test/detect.test.ts`.

Categorisation is a judgement call; if a license is ambiguous, open an issue to
discuss before mapping it.

## Commit messages

Use clear, imperative commit messages (e.g. "Add MPL-2.0 to weak-copyleft").
Conventional Commits are welcome but not required. Do not pad history with
no-op commits.

## Reporting bugs / requesting features

Use the issue templates. For security issues, follow
[SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Code of conduct

Be kind, be constructive, assume good faith. Harassment of any kind is not
tolerated. Maintainers may remove comments, commits, or contributions that
violate this, and may block repeat offenders.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
