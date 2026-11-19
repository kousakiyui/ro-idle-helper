# Gemini project instructions

Follow all rules in [AGENTS.md](AGENTS.md). These instructions apply to every Gemini CLI session in this repository.

Read `ro-idle-helper.user.js` and its UserScript metadata before proposing a patch. Treat `main` as protected; use `gemini/<topic>` feature branches and PRs only. Do not merge or publish without human approval.

When reviewing a Codex PR, focus on regressions to existing features, persisted GM_* values, compatibility with Tampermonkey and https://ro-idle.app/, unexpected selectors or data assumptions, security, and safe async/DOM behavior. Provide actionable findings with file and line references; do not approve based solely on syntax checks. If you cannot access the code or execute a test, state that explicitly.

Never print or transmit secrets. Do not modify the production userscript as part of this collaboration-setup PR.
