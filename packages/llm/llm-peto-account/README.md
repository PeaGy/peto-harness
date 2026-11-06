---
description: "Peto Web model route and web search: the Peto account's device token authenticates the Peto Agent gateway and its search endpoint."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-peto-account

English | [中文](README.zh.md)

## Summary

Use the models of your Peto account in Peto Agent without an API key, and search the web through Peto Web. Model calls and searches go to the Peto Agent gateway with the device token that [dsh-peto-account](../../credentials/peto-account/README.md) keeps. Each model call and each search query costs Peto Agent steps from the account's daily allowance; running out shows the account's own notice instead of a provider error.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Set `baseURL` to `<server>/api/agent/v1`; its origin must be the account's `server`. HTTPS is required except on loopback.

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | required | Peto Agent gateway base URL |
| `displayName` | `Peto` | Route name in model selectors |
| `modelsTimeoutMs` | `15000` | Deadline of one model listing request |
| `modelsMaxAgeMs` | `300000` | Listing age after which the next lookup reloads it |
| `modelsRetryMs` | `10000` | Wait after a failed listing before the next attempt |
| `searchTimeoutMs` | `60000` | Deadline of one web search |

While signed out the route offers no models, requests fail with `MISSING_CREDENTIAL`, and the search provider is not ready, so the agent gets no `web_search` tool.

### Search the web

Where the web seam runs, the package registers the `peto` search provider, which the base bundle selects for `web_search`; Plugins → Web search and fetch can switch back to a DeepSeek provider. A search posts `{ query, count, need_content: false, ori_question }` to `<baseURL>/search`: `count` is at most 10 and lower when the tool asks for fewer results, and `ori_question` is the user's latest prompt, whitespace collapsed and cut to 128 code points, as DeepSeek's Search API provider sends it. The reply uses the DeepSeek Search API shape and is mapped the way [dsh-web-deepseek-api](../../web/web-deepseek-api/README.md) maps it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Requests go through the [pi-ai adapter](../llm-pi-ai/README.md) in OpenAI Responses form. The catalog comes from `GET <baseURL>/models` with the token as a Bearer credential; redirects fail. Each entry becomes a text-and-image model with its `display_name`, `context_window` and `max_output_tokens`, and the Peto `reasoning_efforts` field selects the offered levels, with Peto's `none` offered as `off`; a gateway without the field offers `low`, `medium` and `high`. The listing loads before every model lookup and request when the token changed or the listing is older than `modelsMaxAgeMs`. A failed reload keeps the previous listing of the same token; a token that cannot be listed offers nothing. Sign-in, sign-out and credential changes reload the listing and emit `llm/models-updated` when the catalog changed.

The gateway answers a used-up daily allowance with `insufficient_quota`, which pi-ai reports as `QUOTA`; the route recodes it as `ACCOUNT_QUOTA`, so the account feature's notice explains the steps and their reset time. The search provider ([src/search.ts](src/search.ts)) restates the web seam's types instead of importing them, so the package adds no dependency. HTTP 401 from the listing or a search reports the token through `rejectToken`; other search failures carry Peto Web's error message.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Authenticated model requests

#### What the model sees

Requests on `peto` add no model-visible text from this plugin; [dsh-llm-pi-ai](../llm-pi-ai/README.md) serializes them, and the gateway forwards the harness's own instructions and tools.

#### Token effect

Authentication and the listing add no input tokens. The listed `context_window` and `max_output_tokens` set each model's context window and default output cap.

#### KV Cache effect

Credentials and the catalog do not enter model input; the pi-ai transport owns request-prefix serialization. The gateway's rewrites are deterministic (reasoning first within each model turn, tool-result images moved into a following user message), so a repeated prefix stays the same.

### Conversation tool results

#### What the model sees

While `peto` is the selected search provider, `web_search` results list the returned sources with their summaries or snippets and dates, after the external-content notice that [dsh-tool-web](../../web/tool-web/README.md) adds. Search failures carry Peto Web's message, such as the daily step limit.

#### Token effect

Each query runs one auxiliary model call on Peto Web, outside the conversation's tokens, and costs one Peto Agent step. Conversation result tokens scale with the returned summaries and snippets and are bounded by the consumer.

#### KV Cache effect

Tool results append after the existing conversation prefix. Provider registration adds no model context.

### Conversation tool list, indirectly

#### What the model sees

While `peto` is selected, a request made while signed out carries neither the `web_search` schema nor its prompt guidance; [`dsh-tool-web`](../../web/tool-web/README.md#search-readiness) owns that effect.

#### Token effect

Withholding removes the tool's schema and its prompt guidance from the request.

#### KV Cache effect

Signing in or out changes the declared tools as [`dsh-tool-web`](../../web/tool-web/README.md#search-readiness) describes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Steps, not tokens** — Peto Web charges model calls and search queries in Peto Agent steps; a `web_search` call with several queries costs one step per query.
- **Model-written summaries** — Peto Web keeps only pages its own search returned, but each summary and date comes from Peto's model rather than a search index; a reply it cannot parse leaves results with titles only.
- **No search inside model requests** — the gateway never searches on its own; the agent searches only through the `web_search` tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
