---
description: "Peto Web 模型路由：Peto 账号的设备令牌为 Peto Agent 网关鉴权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-peto-account

[English](README.md) | 中文

## 概述

注册 `peto` 路由。请求通过 [pi-ai 适配器](../llm-pi-ai/README.zh.md) 以 OpenAI Responses 形式发往 Peto Agent 网关，并使用 [dsh-peto-account](../../credentials/peto-account/README.zh.md) 为 `baseURL` 解析出的令牌鉴权。Peto Web 按账号的每日 Agent 步数为每次调用计费。

## 目录

- [使用此包](#use-this-package)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

把 `baseURL` 设为 `<server>/api/agent/v1`；它的源必须是账号的 `server`。除回环地址外必须使用 HTTPS。

模型目录来自以令牌作为 Bearer 凭据请求的 `GET <baseURL>/models`；重定向会失败。每个条目成为一个接受文本和图片的模型，带有其 `display_name`、`context_window` 和 `max_output_tokens`。Peto 的 `reasoning_efforts` 字段决定可选级别，其中 Peto 的 `none` 以 `off` 提供；没有该字段的网关提供 `low`、`medium` 和 `high`。当令牌变化或列表早于 `modelsMaxAgeMs` 时，每次模型查询和请求之前都会先加载列表。重新加载失败时保留同一令牌的上一份列表，并等待 `modelsRetryMs` 后再试；无法列出的令牌不提供任何模型。列表请求返回 HTTP 401 时通过 `rejectToken` 报告该令牌。登录、登出和凭据变化会重新加载列表，目录变化时发出 `llm/models-updated`。

登出期间该路由不提供模型，请求以 `MISSING_CREDENTIAL` 失败。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

网关不执行网页搜索，面向模型的网页工具仍经由 DeepSeek 的搜索提供方。
