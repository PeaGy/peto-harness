---
description: "Peto Web 模型路由与网页搜索：Peto 账号的设备令牌为 Peto Agent 网关及其搜索接口鉴权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-peto-account

[English](README.md) | 中文

## 概述

在 Peto Agent 中使用 Peto 账号的模型，无需 API Key，并通过 Peto Web 搜索网页。模型调用和搜索都带着 [dsh-peto-account](../../credentials/peto-account/README.zh.md) 保存的设备令牌发往 Peto Agent 网关。每次模型调用和每个搜索查询都从账号的每日额度中扣除 Peto Agent 步数；额度用完时显示账号自己的提示，而不是提供方错误。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `baseURL` 设为 `<server>/api/agent/v1`；它的源必须是账号的 `server`。除回环地址外必须使用 HTTPS。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | 必填 | Peto Agent 网关的基础 URL |
| `displayName` | `Peto` | 模型选择器中的路由名称 |
| `modelsTimeoutMs` | `15000` | 一次模型列表请求的期限 |
| `modelsMaxAgeMs` | `300000` | 列表超过此时长后，下一次查询会重新加载 |
| `modelsRetryMs` | `10000` | 列表加载失败后到下一次尝试的等待时间 |
| `searchTimeoutMs` | `60000` | 一次网页搜索的期限 |

登出期间该路由不提供模型，请求以 `MISSING_CREDENTIAL` 失败，搜索提供方也未就绪，因此智能体拿不到 `web_search` 工具。

### 搜索网页

在网页接缝运行的环境中，本包注册 `peto` 搜索提供方，基础组合为 `web_search` 选用它；可以在「插件 → 网页搜索与获取」中切回 DeepSeek 的提供方。一次搜索把 `{ query, count, need_content: false, ori_question }` 发送到 `<baseURL>/search`：`count` 最多为 10，工具要求更少结果时会更小；`ori_question` 是用户最近一次输入，空白被合并并截取为 128 个码点，与 DeepSeek 搜索 API 提供方的做法相同。回复采用 DeepSeek 搜索 API 的格式，并按 [dsh-web-deepseek-api](../../web/web-deepseek-api/README.zh.md) 的方式映射。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

请求通过 [pi-ai 适配器](../llm-pi-ai/README.zh.md) 以 OpenAI Responses 形式发出。模型目录来自以令牌作为 Bearer 凭据请求的 `GET <baseURL>/models`；重定向会失败。每个条目成为一个接受文本和图片的模型，带有其 `display_name`、`context_window` 和 `max_output_tokens`，Peto 的 `reasoning_efforts` 字段决定可选级别，其中 Peto 的 `none` 以 `off` 提供；没有该字段的网关提供 `low`、`medium` 和 `high`。当令牌变化或列表早于 `modelsMaxAgeMs` 时，每次模型查询和请求之前都会先加载列表。重新加载失败时保留同一令牌的上一份列表；无法列出的令牌不提供任何模型。登录、登出和凭据变化会重新加载列表，目录变化时发出 `llm/models-updated`。

额度用完时网关返回 `insufficient_quota`，pi-ai 把它报告为 `QUOTA`；该路由把它改记为 `ACCOUNT_QUOTA`，于是由账号功能的提示说明步数及其重置时间。搜索提供方（[src/search.ts](src/search.ts)）在本地重述网页接缝的类型而不导入它们，因此本包不增加依赖。列表或搜索返回 HTTP 401 时通过 `rejectToken` 报告该令牌；其他搜索失败带有 Peto Web 的错误消息。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 已鉴权的模型请求

#### 模型看到什么

`peto` 上的请求不包含本插件添加的模型可见文本；[dsh-llm-pi-ai](../llm-pi-ai/README.zh.md) 负责序列化，网关转发套件自己的指令和工具。

#### Token 影响

鉴权和列表不增加输入 token。列表中的 `context_window` 和 `max_output_tokens` 决定每个模型的上下文窗口和默认输出上限。

#### KV Cache 影响

凭据和目录不进入模型输入；pi-ai 传输负责请求前缀的序列化。网关的改写是确定性的（每个模型回合内推理在前，工具结果中的图片移入其后的用户消息），因此重复的前缀保持不变。

### 会话工具结果

#### 模型看到什么

当 `peto` 是所选的搜索提供方时，`web_search` 结果在 [dsh-tool-web](../../web/tool-web/README.zh.md) 添加的外部内容提示之后，列出返回的来源及其概述或摘要和日期。搜索失败时带有 Peto Web 的消息，例如每日步数上限。

#### Token 影响

每个查询在 Peto Web 上运行一次辅助模型调用，不计入对话 token，并消耗一个 Peto Agent 步数。对话结果的 token 随返回的概述和摘要增长，并受使用方限制。

#### KV Cache 影响

工具结果追加在现有对话前缀之后。注册提供方不增加模型上下文。

### 会话工具列表（间接）

#### 模型看到什么

选用 `peto` 时，登出状态下的请求既不带 `web_search` 的模式，也不带它的提示指引；该效果由 [`dsh-tool-web`](../../web/tool-web/README.zh.md#search-readiness) 负责。

#### Token 影响

撤下工具会从请求中移除该工具的模式及其提示指引。

#### KV Cache 影响

登录或登出会按 [`dsh-tool-web`](../../web/tool-web/README.zh.md#search-readiness) 所述改变声明的工具。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **按步数而非 token 计费** — Peto Web 以 Peto Agent 步数为模型调用和搜索查询计费；一次带多个查询的 `web_search` 调用按每个查询一步计费。
- **概述由模型撰写** — Peto Web 只保留自身搜索返回的页面，但每条概述和日期来自 Peto 的模型而非搜索索引；无法解析的回复会只留下带标题的结果。
- **模型请求内不搜索** — 网关从不自行搜索；智能体只通过 `web_search` 工具搜索。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
