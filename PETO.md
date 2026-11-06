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
  own feed (for example GitHub Releases) or disable it. See `apps/desktop/README.md#updates`. **The owner handles this
  one**; the artifact names (`deepseek-harness-<version>-…`) go with it. Installers are published as GitHub Releases
  of this repo (public since 2026-11-06), tagged `v<version>`; Peto Web's `/download/` page links the newest release
  that has an `.exe`, `.msi` or `.dmg` (steps in Peto-Web `deploy/OPERATIONS.md`, "Phát hành bản Peto Agent").
- **Desktop product analytics.** Off (stage 3, see "DeepSeek services cut").
- **Session telemetry.** Off (stage 3): it released the Session log behind every feedback rating to DeepSeek's
  collector.
- **Feedback questionnaire.** Off (stage 3): the account menu's Feedback opened DeepSeek's Feishu form prefilled with
  the account id and device details.
- **DeepSeek account and Platform pages.** `packages/credentials/deepseek-account-platform`,
  `packages/llm/llm-deepseek-account` and the embedded Platform views use `platform.deepseek.com` and `api.deepseek.com`.
  Replaced by Peto sign-in (next section); with it the Platform pages never open.
- **Kept, because the user chooses them:** the DeepSeek model provider and DeepSeek web search behind the user's own
  DeepSeek API key (Add API key), and links to DeepSeek's API docs in those settings. Without a key they make no request.
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

`POST /api/agent/step` imposes the server's own instructions and tool schemas (the Python CLI's), so Peto-Web now has
an **OpenAI Responses–compatible gateway** for this app (Peto-Web `features/agent/gateway.py`, commit `e29858f`, deployed
2026-11-05; owner's
decisions: Responses protocol, no Peto prompt injected, steps charged like the CLI, open to every account):
- `GET /api/agent/v1/models`: the account's Agent models (`id` is Peto's key: `peto`, `luna`, `haiku`, … plus
  `display_name`, `context_window`, `max_output_tokens`).
- `POST /api/agent/v1/responses`: streaming only, Bearer device token, the harness's own instructions and function
  tools. Errors are OpenAI-shaped with `x-should-retry`; quota exhaustion is 429 `insufficient_quota`, context overflow
  400 `context_length_exceeded`.
- Verified with this repo's pi-ai 1.3.0 `openai-responses` client against a mock Peto backend (text, thinking, tool
  call and result, replay).
- Each `/models` entry also carries `reasoning_efforts` (Peto Web's effort names for that model; Peto-Web change after
  `e29858f`, needs deploying). Without it the app offers low/medium/high for every model.

The sign-in and model route in this repo (built 2026-11-05, two new packages):
- `packages/credentials/peto-account` (`@deepseek-ai/dsh-peto-account`) provides the shared `deepseekAccount` Service
  Definition from `dsh-deepseek-account`, mounted under the existing `deepseek-account` entry id. The account controller
  (`account` RPC namespace), the desktop Welcome window, its waiting page and Copy link button, sign-out and the
  expiry notice all work unchanged. Sign-in is the device code above; the token is a `peto-account/default` grant in the
  harness credential store, bound to `server` and handed only to URLs on it. Sign-out revokes it through
  `POST /api/agent/logout`. A refusal on the web ends the attempt as cancelled.
- `packages/llm/llm-peto-account` (`@deepseek-ai/dsh-llm-peto-account`) registers route `peto`: pi-ai's
  `PiAiAdapter` in `openai-responses` form against `baseURL`, API key = the account token, catalog from the gateway's
  `/models` (loaded before every lookup and request, reloaded on sign-in/out). The default Agent model is `peto/peto`.
- Server address: `https://peto.pearto.shop` in `packages/bundle/base/cordis.patch.yml` (both entries); a private
  `$DSH_HOME/cordis.patch.yml` can override it. Not a credential.
- Tests: `tests/account.spec.ts` (27) and `tests/provider.spec.ts` (10) against fake Peto servers on 127.0.0.1, including
  one streamed reply through pi-ai. Line coverage 100% / ~90%; branch coverage is below upstream's 100% gate (mostly
  disposal races).

Next: the account card (account name, steps and tokens today from `/me`, "Manage" opens Peto Web → Settings → Peto
Agent); it still renders DeepSeek's Platform layout over this account. The model-facing web_search/web_fetch tools still
use DeepSeek's search providers; the gateway runs no web search.

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
2. Branding: Welcome screen, app name, icons, tray and installer names, About credit. Mockups first. Done: Welcome
   screen, the agent's own introduction, the name in text ("App name" below), the in-app mark ("Brand mark") and the
   app, tray, installer and Web icons ("App icons"). Left: the experimental liveshare viewer still draws the whale.
3. Cut DeepSeek services: analytics, Session telemetry and the Feedback questionnaire are off ("DeepSeek services
   cut"); the update feed is the owner's.
4. Peto sign-in: Peto-Web gateway (deployed), sign-in and model route here (built; the owner signed in with Peto and
   chatted with model `peto` in `dev:desktop` on 2026-11-05), then the account card.
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
  - "Sign in" now signs in to Peto (stage 4) and keeps its upstream label; the API key page still describes DeepSeek
    keys, which is what it saves. The product name elsewhere (menus, tray, installer, About) is under "App name".
- Peto sign-in (stage 4):
  - `packages/bundle/base/cordis.patch.yml`: the `deepseek-account` entry mounts `@deepseek-ai/dsh-peto-account`
    instead of `@deepseek-ai/dsh-deepseek-account-platform`; new `llm-peto-account` entry; `agent-default-model` is
    `peto/peto` instead of `deepseek-official/deepseek-flash`. `packages/bundle/base/package.json` lists both packages.
  - `packages/llm/llm-pi-ai/src/index.ts` also exports `resolveProfiles`, `authContextFrom` and `credentialStoreFrom`;
    its `adapter.spec.ts` "keeps adapter helpers off the package root" now expects `resolveProfiles` on the root.
  - `tsconfig.base.json` (regenerated aliases), `tsconfig.host.json` (two references) and `pnpm-lock.yaml` (two
    workspace importers, no new external packages).
- Agent identity (2026-11-05; before it the agent answered "I'm lead … running in DeepSeek Harness"):
  - `packages/bundle/web-app/cordis.patch.yml`: the `system-prompt` row sets `includeHarnessIdentity: false` (drops
    the fixed "You are an AI agent powered by DeepSeek Harness." opener) and the Peto `personaPrefix`; the
    `standard`, `ptc` and `cordis` presets in `packages/bundle/web-app/presets/` carry the same persona: "You are
    Peto, a coding agent powered by the {{model}} model. Introduce yourself to users as Peto; an agent name given in
    the runtime context only identifies you to other agents." (`lead` stays the root agent's internal name, which
    sessions and subagent tools rely on.) `minimal` keeps its complete prompt, which names no product.
  - `snapshots/web/*/system-prompt.expected.md` (eight goldens) and `apps/web/tests/replay-round-trip.e2e.ts` follow
    that text. New Peto test: `packages/bundle/web-app/tests/peto-identity.spec.ts`, which fails if a merge restores
    the upstream rows.
  - `packages/context/harness-dev-context/src/index.ts`: the current section and runtime-context text says "the Peto
    Agent Web GUI" and "the Peto Agent implementation checkout" (before it the agent called the app "your DeepSeek
    Harness workspace"). `LEGACY_SOURCE` and `LEGACY_WEB_SURFACE` stay upstream's frozen text: they only recognise
    paragraphs that Sessions from earlier releases already admitted. Its tests and README quotes follow, as do
    `packages/bundle/web-app/src/index.ts` (the `DSH_WEB_URL` description), the web test scaffold's normaliser,
    `replay-round-trip`, `smoke-real`, `web-runtime-context/web-surface-prompt.expected.md`,
    `snapshots/web/fresh-round-trip/web-context.expected.md`, the SDK absence checks (`snapshots/sdk/sdk.snapshot.ts`,
    `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts`) and the recorded runtime-context sections in
    `snapshots/web/*/session*.v4.jsonl`.
  - Not changed: the headless, SDK and ACP bundles keep upstream's persona and opener (they serve the `dsh` CLI and
    SDK, not the app).
- App name (stage 2, 2026-11-05). The app is "Peto Agent", as on the Welcome screen; "Built on DeepSeek Harness" is the
  About credit. Engine-level names stay upstream's: the `dsh` command and its help, the SDKs, package descriptions shown
  on the Plugins page, "DSH plugin" in Creator mode, `~/.dsh`, docs and notes.
  - `apps/desktop/src/locale.ts`, eight languages: menus, tray, quit dialog, startup failure, update title. New
    `aboutCredit` ("Built on DeepSeek Harness" and translations) under the version in the Windows About dialog
    (`apps/desktop/src/main.ts`), and as the macOS About panel's copyright line; its `applicationName` is the localized
    product name.
  - `apps/desktop/scripts/electron-builder-config.mjs`: `productName` "Peto Agent" (executable `Peto Agent.exe`, macOS
    `Peto Agent.app`, install folder, Electron's userData directory `%APPDATA%\Peto Agent`), the `dsh:` protocol name,
    the microphone usage text, and `extraMetadata.author`/`description` ("Peto", "Peto Agent, built on DeepSeek
    Harness"), which become the Windows company name, installer publisher and file description in place of DeepSeek's
    company (`tests/installer-packaging.spec.ts`). Hardcoded executable paths follow: `apps/desktop/cli/dsh`, `dsh.cmd`,
    `scripts/package-macos.ts`, `package-target.ts`, `smoke-packaged-runtime.ts`, `verify-retained-desktop.ts`,
    `development-app.ts`, `electron-builder.config.d.mts`. Artifact names (`deepseek-harness-<version>-…`) are
    unchanged: the upload, update-feed and version-discovery scripts match them, so they change with stage 3.
  - Installer: `apps/desktop/installer/locales/*.json` (eight) and `extract-report.h`.
  - Client copy: `packages/client/ui-settings-account` (account page and first-run onboarding), `ui-plugin-manager`
    (install warning), `ui-sidebar-documentpreview` (Office preview notice), `packages/experimental/cua` (approval
    notice). The onboarding credit step and the account page still describe DeepSeek's balance and top-up; that
    belongs to the account card.
  - `packages/client/ui-settings-models`: the first-run "Preview Notice" was DeepSeek's own letter; it is rewritten as
    Peto's notice ("Peto Agent is still in preview … built on DeepSeek Harness 0.2 …") in all eight languages.
  - Local builds: `brand.localBuild` in `packages/client/locale` is "Peto Local Build" (sidebar and window title of
    `dev:desktop`); `apps/web/index.html`, `apps/web/vite.config.ts` and `apps/web/public/manifest.webmanifest` follow.
    The official build profile's title (`scripts/client-build-environment.ts`) is "Peto Agent"; its sidebar shows the
    Peto mark and name ("Brand mark").
  - Tests and goldens updated with the copy: `apps/desktop/tests/**`, `apps/web/tests/expected/**`,
    `WELCOME_NOTICE_COPY` in `apps/web/tests/scaffold.ts`, the onboarding/plugin/manifest web tests and the client
    package tests that pin it.
  - Verification on Windows (2026-11-05): web snapshots were not re-recorded, since upstream records them on
    Linux/macOS and many already replay differently here (no `bash` tool, local skills). Sixteen representative web
    test files were run before and after the change: no new failure, and the onboarding, plugin-install, manifest and
    Preview Notice goldens pass with the new copy. The SDK snapshot lane (`snapshots/sdk`) fails on this machine before
    its runtime-context checks (its replay does not intercept the DeepSeek request), so its absence checks were not run.
- Brand mark (stage 2, 2026-11-05; the owner picked "A. Đặc" of three monochrome mockups): new package
  `packages/client/ui-brand-peto` (`@deepseek-ai/dsh-client-ui-brand-peto`) fills `sidebar.brand.mark` (expanded
  sidebar and collapsed rail) and `conversation.hero.brand.mark` with the Welcome logo traced into one solid
  `currentColor` silhouette, so it follows the theme like the whale; `official` builds also get "Peto Agent" in
  `sidebar.brand.name`. `packages/bundle/web-app/cordis.patch.yml` and `package.json` mount it instead of
  `ui-brand-official`, which also drops the click-triggered home whale. Registered in `tsconfig.base.json`,
  `tsconfig.client.json`, `scripts/verify-package-readme-model-experience.ts`, `pnpm-lock.yaml` and the generated
  `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`.
- App icons (stage 2, 2026-11-05; the owner picked "A. Nền trắng · logo đặc" of three mockups): upstream's tile,
  gradients, shadows and dark glyph gradient stay; only the whale path is replaced by the Peto mark (centred at
  (556, 566), 760 units wide, in the shared 1024 tile space).
  - `apps/desktop/resources/icon-windows.svg`, `icon-macos.svg`, `icon.svg` carry the traced mark with its hair
    highlights; their PNGs (`icon-windows.png` 1024, `icon-macos.png` 1024, `icon.png` 1104) are rendered from them
    with sharp at 1:1.
  - New `apps/desktop/resources/tray-windows.svg`: the Windows tile with the simplified in-app mark, which stays crisp
    at 16–64 px. `apps/desktop/scripts/render-tray-icon.ts` reads it instead of `icon-windows.svg` (one line);
    `tray-windows.ico` is its output (`pnpm run render:tray-icon` in `apps/desktop`).
  - Web: `apps/web/public/favicon.svg` and `favicon-dark.svg` are the simplified mark (black and white, as upstream);
    `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png` come from upstream's own
    `apps/web/scripts/render-app-icons.ts` over the new `icon.svg`.
  - Installer: `apps/desktop/installer/assets/brand*.png` (light and dark, 1x and 2x) show the mark on the light disc
    above the Welcome lockup ("Peto" and the AGENT chip from `welcome-brand.svg`, scaled 1.25) instead of "deepseek
    HARNESS"; `uninstaller-sidebar.png` shows the tile. These and the desktop PNGs were rendered with sharp from
    SVG built on the same tile defs; no script for them is committed, so redo them the same way if the mark changes.
  - Checked: tray-icon, installer-packaging, main-startup and tray specs, the Web `app-icons` spec and
    `pwa-manifest.e2e.ts` (maskable safe circle) pass. The NSIS installer itself was not built.
- DeepSeek services cut (stage 3, 2026-11-05; the update feed stays with the owner):
  - `packages/bundle/base/cordis.patch.yml`: `session-telemetry-otel` is `disabled: true`. In `FEEDBACK_ONLY` mode it
    sent the Session log prefix behind each Like/Dislike or `/feedback` to `dsh-otel-collector.deepseeksvc.com`.
    Ratings still record in the local Session log. `packages/client/ui-message-feedback` (eight languages): the
    dialog hint no longer promises to send the conversation log ("Your rating and notes are saved with this
    conversation and are not sent anywhere."); its client spec and `message-feedback.e2e.ts` follow. Revisit that line
    if telemetry is ever pointed at a Peto collector.
  - `packages/bundle/web-app/cordis.patch.yml`: `desktop-product-telemetry` and `product-analytics` are `disabled: true`
    in every profile (upstream enabled them for `desktop`; their exporter's only destination is the same collector).
    Electron treats the missing analytics policy as disabled. `ui-settings-account` gets `contactFormUrl: ''`.
  - `packages/client/ui-settings-account`: `contactFormUrl` also accepts `''`, which leaves `contactUs` undefined and
    the account menu without Feedback (`contact-config.ts`, `client/index.ts`, `AccountSection.tsx`,
    `AccountMenu.tsx`, both READMEs). The upstream default is still the Feishu form.
  - Tests: `packages/bundle/base/tests/base.spec.ts` expects the telemetry row disabled;
    `packages/bundle/web-app/tests/product-analytics.spec.ts` now checks both rows stay off in `desktop` and `web`;
    new `packages/bundle/web-app/tests/peto-privacy.spec.ts` pins all three switches; `apps/web/tests/scaffold.ts`
    enables the telemetry row when a scenario brings its own loopback collector, so `feedback-release.e2e.ts` still
    exercises the pipeline; new empty-URL cases in the account `apply`, `account` and `contact-url` specs.
  - Checked at runtime: `dsh web` with a throwaway home and an outbound-connection logger, browsing the UI, the
    account menu and Settings, contacted only `127.0.0.1`. The Desktop profile itself was not launched.
