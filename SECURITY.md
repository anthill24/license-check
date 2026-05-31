# Security Policy

## Threat model

`license-check` is deliberately low-risk by design:

- It performs **no network I/O** during scanning — no registry calls, no
  telemetry.
- It **does not execute** any dependency code. It only **reads** files
  (`package.json` and `LICENSE`/`COPYING` files) from the local filesystem.
- It has **zero runtime dependencies**, minimising supply-chain exposure.

The most relevant risks are therefore around parsing untrusted files (malformed
`package.json` or `LICENSE` content) and path handling while walking
`node_modules`. Reports in those areas are especially valued.

## Supported versions

This is an early-stage project. Security fixes are applied to the latest
released version on a best-effort basis.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ (latest) |
| < 0.1 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (Private Vulnerability Reporting).
3. Include a description, reproduction steps, affected version, and impact.

If private reporting is unavailable, contact the maintainer through their
GitHub profile (<https://github.com/anthill24>) and request a private channel
before sharing details.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you. There is no bug-bounty program.

## Scope

In scope:

- Crashes, path traversal, or resource exhaustion triggered by crafted files in
  a scanned `node_modules` tree.
- Incorrect policy evaluation that could cause a violating license to be
  reported as allowed.

Out of scope:

- The accuracy of the license **category** labels themselves (this is a
  documented heuristic — see the disclaimer in the README).
- Issues requiring a malicious local environment the user already fully controls.
