---
description: "Sign in to Peto Web with the Peto Agent device code, keep the device token in the local credential store, and read the account's daily Peto Agent steps."
kind: "package-reference"
---

# @deepseek-ai/dsh-peto-account

English | [中文](README.zh.md)

## Summary

Sign in to Peto Web from the app with a device code, without an API key. The device token stays in this computer's credential store and goes only to the configured Peto Web server. The account page then shows the Peto account name and today's Peto Agent steps, and the Peto model route and web search authenticate with the token. It replaces DeepSeek Platform sign-in through the same account service, so the account controller and the Welcome window work unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it under the `deepseek-account` entry id with `server` set to the Peto Web origin. `server` must be HTTPS; HTTP is accepted only on loopback with `allowLoopbackHttp: true`.

| Field | Default | Meaning |
|---|---|---|
| `server` | required | Peto Web origin serving the device flow and the gateway |
| `deviceName` | host name | Name of this device in Peto Web, Settings → Peto Agent |
| `allowLoopbackHttp` | `false` | Accept plain HTTP on a loopback `server` for development |
| `requestTimeoutMs` | `30000` | Deadline of each Peto Web request |
| `attemptTimeoutMs` | `600000` | Upper bound of one sign-in attempt |

`startSignIn` posts the device name to `POST /api/agent/device/start`, publishes `waiting-browser` with the approval page, and polls `POST /api/agent/device/token` at the server's interval. The approval page is the server's `verification_url` when it carries the same code, otherwise `<server>/?agent_code=<code>`. Approval commits `{ version: 1, server, token, deviceId, deviceName, account }` as the `peto-account/default` grant through the authorization seam. A refusal on the page ends the attempt as `cancelled`, an expired code as `expired`. Up to three consecutive dropped connections or server errors while polling are retried; one more fails the attempt.

`resolveToken(url)` returns the token only for URLs on `server`, so only the [Peto model route and its search provider](../../llm/llm-peto-account/README.md) receive it. A grant whose `server` differs from the configuration is deleted at mount and never forwarded.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`getProfile` and `getBalance` both read `GET /api/agent/me`; the two queries of one refresh share a single request. The profile reports the `account` name with the device ID as the account ID, and a failed read keeps the name stored at sign-in. Peto Web meters daily Agent steps instead of a wallet, so the ready balance carries no wallets and an optional `steps` record: used and limit, the reset instant from `steps_reset_at` (absent from older servers), today's tokens, and the steps per request of each model the account may use. A failed or unusable answer is a failed balance. HTTP 401 on that read, or `rejectToken` with the stored token, deletes the grant and emits `deepseek-account/session-expired` and `deepseek-account/signed-out`.

The account links carry `manageUrl`, `<server>/?settings=agent`, which Peto Web opens at Settings → Peto Agent; the account page and the quota notice key their Peto layout on it. `signOut` deletes the grant, emits `deepseek-account/signed-out` and revokes the device through `POST /api/agent/logout` in the background. `getUnnotifiedBonuses` returns no bonuses, `ackBonusNotified` returns false and `getPlatformSession` returns null.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the device token affects HTTP authentication only and account details never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wallet or top-up** — Peto Web meters daily steps, so the DeepSeek Platform pages for usage and top-up have nothing to show; the account page links to Peto Web instead.
- **Steps are a snapshot** — the account page shows what `/api/agent/me` returned at its last refresh, which opening Settings triggers; steps spent since then appear on the next refresh.
- **Revocation is best effort** — sign-out deletes the local grant first; when `POST /api/agent/logout` fails, the device stays listed in Peto Web until the user removes it there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
