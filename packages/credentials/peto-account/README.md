---
description: "Sign in to Peto Web with the Peto Agent device code and keep the device token in the local credential store."
kind: "package-reference"
---

# @deepseek-ai/dsh-peto-account

English | [中文](README.zh.md)

## Summary

Provide the shared `deepseekAccount` Service Definition from [dsh-deepseek-account](../deepseek-account/README.md) for Peto Web. The account controller, the desktop Welcome window and model consumers use it unchanged; only sign-in, storage and token routing differ from [dsh-deepseek-account-platform](../deepseek-account-platform/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount it under the `deepseek-account` entry id with `server` set to the Peto Web origin. `server` must be HTTPS; HTTP is accepted only on loopback with `allowLoopbackHttp: true`. `deviceName` names this device in Peto Web, Settings → Peto Agent, and defaults to the host name. `requestTimeoutMs` bounds each request and `attemptTimeoutMs` bounds one sign-in attempt.

`startSignIn` posts the device name to `POST /api/agent/device/start`, publishes `waiting-browser` with the approval page, and polls `POST /api/agent/device/token` at the server's interval. The approval page is the server's `verification_url` when it carries the same code, otherwise `<server>/?agent_code=<code>`. Approval commits `{ version: 1, server, token, deviceId, deviceName, account }` as the `peto-account/default` grant through the authorization seam. A refusal on the page ends the attempt as `cancelled`, an expired code as `expired`. Up to three consecutive dropped connections or server errors while polling are retried; one more fails the attempt.

`resolveToken(url)` returns the token only for URLs on `server`, so the [Peto model route](../../llm/llm-peto-account/README.md) and nothing else receives it. A grant whose `server` differs from the configuration is deleted at mount and never forwarded.

<a id="understand-the-implementation"></a>
## Understand the implementation

`getProfile` reads `GET /api/agent/me` and reports its `account` name with the device ID as the account ID; a failed read keeps the name stored at sign-in. HTTP 401 on that read, or `rejectToken` with the stored token, deletes the grant and emits `deepseek-account/session-expired` and `deepseek-account/signed-out`. `signOut` deletes the grant, emits `deepseek-account/signed-out` and revokes the device through `POST /api/agent/logout` in the background; a failed revocation never restores the grant.

Peto Web meters daily Agent steps instead of a wallet: `getBalance` returns no wallets, `getUnnotifiedBonuses` returns no bonuses, `ackBonusNotified` returns false and `getPlatformSession` returns null. Account links point at the server root, where Peto Web opens its own Settings.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The Settings account card still renders DeepSeek's Platform layout over this projection. Daily step usage from `/api/agent/me` is not shown yet.
