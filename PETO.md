# PETO.md

Peto-specific instructions for this fork. Read together with [AGENTS.md](AGENTS.md), which stays upstream's file and
still governs how code is written here. When this file and AGENTS.md disagree about Peto product choices, this file wins;
for engineering rules (Cordis, tests, docs, i18n), AGENTS.md wins.

## What this repository is

A fork of DeepSeek Harness (MIT, `LICENSE` keeps DeepSeek's copyright) that becomes the **desktop app for Peto Agent**.
The owner chose to fork instead of writing a desktop app from scratch. It is an agent workspace (files, commands,
sessions on the user's machine), not a desktop version of Peto Web's Chat, Companion or Imagine.

Scope, as decided by the owner (2026-11-04):
- Give it Peto's look: name, logo, icons, colours where they carry the brand. Everything else follows upstream.
- Replace DeepSeek account sign-in with Peto account sign-in; keep "Add API key" for the user's own keys.
- The assistant is named Peto. No other persona, language or tone requirements: UI language and replies follow upstream
  (English UI plus the shipped locales).

## Staying mergeable with upstream

- Remote `upstream` is `https://github.com/deepseek-ai/deepseek-harness.git`. Keep `master` as an upstream mirror and do
  Peto work on its own branch, so `git merge upstream/master` stays routine. Upstream is a developer preview with
  breaking changes; merge often rather than rarely.
- Prefer additions over edits: new plugins, bundle or profile patches, locale entries and assets. When an upstream file
  must change, keep the edit small and add a line to "Peto changes to upstream files" below.
- Do not rename packages (`@deepseek-ai/dsh-*`) and keep the dsh version number equal to upstream's. Plugins check
  `engines.dsh` against `dsh --version`; renaming or renumbering breaks third-party plugins and every merge.
- Branding rules (BRAND_GUIDELINES.md): never call the product "DeepSeek Harness" and do not ship the whale logo as
  Peto's. "Built on DeepSeek Harness" is allowed and belongs in About. Keep `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- Product copy is locale-owned (AGENTS.md "Client UI copy is locale-owned"): change names and taglines in the locale
  dictionaries and the desktop shell's typed messages, not as hardcoded strings.

## DeepSeek services the fork must cut or redirect

A build given to anyone must not keep talking to DeepSeek. Each item below is on by default upstream:
- **Auto-update.** Packaged apps poll a fixed feed on `download.deepseek.com` about every ten minutes and accept a
  mandatory update policy from DeepSeek. Left alone, it would replace Peto's build with DeepSeek's. Point it at Peto's
  own feed (for example GitHub Releases) or disable it. See `apps/desktop/README.md#updates`.
- **Desktop product analytics.** `packages/client/product-analytics` reports selected interactions through the OTel
  product exporter by default, with no user-facing switch. Disable it or point it at Peto.
- **DeepSeek account and Platform pages.** `packages/credentials/deepseek-account-platform`,
  `packages/llm/llm-deepseek-account` and the embedded Platform views use `platform.deepseek.com` and `api.deepseek.com`.
  Replaced by Peto sign-in (next section).
- **Windows signing.** `apps/desktop/windows-signing` targets DeepSeek's certificate. Unsigned builds work but trigger
  SmartScreen; that is acceptable for the owner's own use.

## Peto sign-in

Peto's server lives in the Peto-Web repository (`C:\Users\binhb\Downloads\Peto-Web`, FastAPI; read it for reference,
change it only from a Peto-Web session). Its Agent API is under `/api/agent` and already serves the Python CLI:
- `POST /device/start` `{name}` → `device_code`, `user_code` (`XXXX-XXXX`), `verification_url` (the Peto site with
  `?agent_code=<user_code>`), `expires_in` (10 minutes), `interval`. The user approves in the browser while signed in to
  Peto Web.
- `POST /device/token` `{device_code}` → 428 while pending, 403 denied, 410 expired; on approval returns `token`
  (`peto_…`, shown once, only its hash is stored), `device_id`, `device_name`, `account`.
- `GET /me` with `Authorization: Bearer <token>` → account, today's step usage and limit, allowed `models` (with
  context limits), `agent_features`, `default_effort`.
- Devices are listed and revoked by the user in Peto Web, Settings → Peto Agent.

This maps onto the desktop Welcome flow's existing "waiting for browser / copy link" page.

**Gap:** `POST /api/agent/step` runs one model call but imposes the server's own instructions and tool schemas, which
match the Python CLI's tools, not this harness's. The fork needs a new Peto-Web endpoint that authenticates the device,
charges Peto's daily step quota and calls the chosen model with the harness's own instructions and tools, streaming the
result. A matching LLM adapter plugin here (modelled on `llm-deepseek-account`) uses it. Open decisions for the owner:
- whether the server prepends a short Peto core prompt to the harness's instructions;
- which wire format the endpoint speaks (the harness adapter's request or Responses-style items);
- whether step costs follow the Python CLI's rules (effort × model cost).

Never put Peto's server credentials (xAI, OpenAI, Anthropic keys) in this repository or in a build. Only the user's
device token lives on the user's machine, stored through the harness's credentials service.

## The Python agent-cli

`Peto-Web/agent-cli` (the `peto` command) stays as Peto's benchmark and reference implementation; it is not removed.
- Sessions are not shared: agent-cli keeps them in `%LOCALAPPDATA%\PetoAgent\sessions\` (JSON plus a SQLite journal),
  this harness in its own Session V4 store. Tool names differ, so an imported session could at most be read, not
  continued. No importer is planned.
- Benchmark plan: a second runner in `agent-cli/evals` drives this harness through its Python SDK
  (`dsh --profile sdk`) on the same tasks and graders. Fair comparisons need the same model, source, effort and step
  budget. `run.py selftest` is free; real runs spend steps and need the owner's go-ahead.

## Working with the owner

- UI or visual changes: show two or three mockups and let the owner pick before coding. Screenshot desktop in light and
  dark themes.
- The owner commits, pushes and releases; do not commit unless asked.
- No paid model calls (DeepSeek, xAI, OpenAI, Anthropic) without the owner's go-ahead.
- The owner is on Windows 11. Verify Windows behaviour natively; say what was not checked.
- Talk to the owner in Vietnamese. Code, comments and docs follow upstream's English conventions.

## Stages

1. Build and run upstream unchanged on Windows (`pnpm install`, `pnpm run build`, `pnpm run dev:desktop`).
2. Branding: Welcome screen, app name, icons, tray and installer names, About credit. Mockups first.
3. Cut DeepSeek services: update feed, analytics, Platform pages.
4. Peto sign-in: Peto-Web endpoint, then the adapter and credentials plugin here.
5. Benchmark runner in agent-cli/evals.

## Peto changes to upstream files

- `CLAUDE.md`: upstream symlink to `AGENTS.md`, replaced by a file importing `AGENTS.md` and this file.
- Welcome screen, direction A "as upstream" (owner's pick of three mockups, 2026-11-04): layout unchanged.
  - `apps/desktop/renderer/assets/welcome-brand.svg`: Peto logo (`Peto-Web/frontend/public/docs-assets/logo.webp`,
    embedded PNG), "Peto" in Montserrat Medium from `packages/client/ui-theme` as paths, and an outlined AGENT chip.
    Same 472 × 40 size and colour variables as upstream's file.
  - `apps/desktop/src/locale.ts`, all eight languages: `welcomeTitle`, `welcomeBrand`, `welcomeTaglineBrand` are
    "Peto Agent"; `welcomeDescription` is "Your projects. Peto does the work." and its translations.
  - `apps/desktop/tests/expected/welcome/*`: updated to that copy.
  - Not changed yet: "Sign in" still signs in to DeepSeek, so its label waits for Peto sign-in (stage 4); the API key
    page still describes DeepSeek keys, which is what it saves. The product name elsewhere (menus, tray, installer,
    About) is stage 2's rename.
