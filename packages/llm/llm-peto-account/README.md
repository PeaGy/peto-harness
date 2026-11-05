---
description: "Peto Web model route: the Peto account's device token authenticates the Peto Agent gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-peto-account

English | [中文](README.zh.md)

## Summary

Register the `peto` route. Requests go through the [pi-ai adapter](../llm-pi-ai/README.md) in OpenAI Responses form to the Peto Agent gateway, authenticated with the token that [dsh-peto-account](../../credentials/peto-account/README.md) resolves for `baseURL`. Peto Web charges each call against the account's daily Agent steps.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Set `baseURL` to `<server>/api/agent/v1`; its origin must be the account's `server`. HTTPS is required except on loopback.

The catalog comes from `GET <baseURL>/models` with the token as a Bearer credential; redirects fail. Each entry becomes a text-and-image model with its `display_name`, `context_window` and `max_output_tokens`. The Peto `reasoning_efforts` field selects the offered levels, with Peto's `none` offered as `off`; a gateway without the field offers `low`, `medium` and `high`. The listing loads before every model lookup and request when the token changed or the listing is older than `modelsMaxAgeMs`. A failed reload keeps the previous listing of the same token and waits `modelsRetryMs` before trying again; a token that cannot be listed offers nothing. HTTP 401 on the listing reports the token through `rejectToken`. Sign-in, sign-out and credential changes reload the listing and emit `llm/models-updated` when the catalog changed.

While signed out the route offers no models and requests fail with `MISSING_CREDENTIAL`.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The gateway runs no web search, and the model-facing web tools still route through DeepSeek's search providers.
