# RO Idle Helper — AI collaboration rules

This repository contains a Tampermonkey userscript for https://ro-idle.app/. The source of truth is `ro-idle-helper.user.js`; `main` is the stable release branch.

## Workflow
- Never push directly to `main`; make a task-specific branch (`codex/<topic>`, `gemini/<topic>`, or `fix/<topic>`) and open a pull request.
- Do not merge pull requests, publish to Greasy Fork, or trigger a release without explicit maintainer approval.
- Before editing, inspect the latest source and the relevant related code. Make the smallest practical change; do not rewrite the entire userscript.
- Preserve existing warehouse protection, cross-city market lookup, AFK settings, refinement, item/card annotations, and character income/expense tracking unless an issue specifically requests otherwise.
- Maintain existing GM_* storage keys and persisted data formats; changes to them require a documented migration and explicit approval.
- Preserve the UserScript metadata block, including `@match`, `@grant`, `@run-at`, `@downloadURL`, and `@updateURL`. Do not change `@version` or publishing URLs on feature branches unless the maintainer explicitly requests a release.
- Do not introduce external network destinations, new privileges, third-party dependencies, secrets, or arbitrary remote code execution without explicit justification and review.
- Favor safe DOM updates; do not use `innerHTML` with untrusted game, user, or marketplace data. Keep the UI compatible with day/night modes.
- No automated gameplay or economic actions may be enabled by default as part of a refactor.

## Checks and PR review
- Run `node --check ro-idle-helper.user.js` and any available repository checks. A passing syntax test is not proof of in-game correctness.
- PRs must summarize changed features, potential regressions, any storage/API changes, manual Tampermonkey test steps, and test evidence.
- For code authored by Codex, request Gemini review; for code authored by Gemini, request Codex review. AI opinions are advisory; the maintainer decides when to merge.
- Never claim to have run a browser or game test unless it was actually run. Mark unverified behavior clearly.
- Do not commit account tokens, cookies, gameplay credentials, personal data, or generated dumps.
