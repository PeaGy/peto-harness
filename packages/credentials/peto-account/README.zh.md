---
description: "通过 Peto Agent 设备码登录 Peto Web，并把设备令牌保存在本地凭据存储中。"
kind: "package-reference"
---

# @deepseek-ai/dsh-peto-account

[English](README.md) | 中文

## 概述

为 Peto Web 提供 [dsh-deepseek-account](../deepseek-account/README.zh.md) 中共享的 `deepseekAccount` 服务定义。账号控制器、桌面欢迎窗口和模型使用方无需改动；与 [dsh-deepseek-account-platform](../deepseek-account-platform/README.zh.md) 相比，只有登录、存储和令牌路由不同。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

以 `deepseek-account` 条目 id 挂载，并把 `server` 设为 Peto Web 源。`server` 必须使用 HTTPS；只有在回环地址并设置 `allowLoopbackHttp: true` 时才接受 HTTP。`deviceName` 是此设备在 Peto Web「设置 → Peto Agent」中的名称，默认为主机名。`requestTimeoutMs` 限制每个请求，`attemptTimeoutMs` 限制一次登录尝试。

`startSignIn` 把设备名发送到 `POST /api/agent/device/start`，以批准页面发布 `waiting-browser`，并按服务器给出的间隔轮询 `POST /api/agent/device/token`。当服务器的 `verification_url` 携带同一代码时使用它作为批准页面，否则使用 `<server>/?agent_code=<code>`。批准后，通过授权接缝把 `{ version: 1, server, token, deviceId, deviceName, account }` 作为 `peto-account/default` 授权记录提交。在页面上拒绝会以 `cancelled` 结束尝试，代码过期则以 `expired` 结束。轮询期间连续最多三次连接中断或服务器错误会重试；再多一次则尝试失败。

`resolveToken(url)` 只为 `server` 上的 URL 返回令牌，因此只有 [Peto 模型路由](../../llm/llm-peto-account/README.zh.md) 会收到它。`server` 与配置不同的授权记录会在挂载时删除，且永不转发。

<a id="understand-the-implementation"></a>
## 理解实现

`getProfile` 读取 `GET /api/agent/me`，以其中的 `account` 名称作为名称、以设备 ID 作为账号 ID；读取失败时保留登录时保存的名称。该读取返回 HTTP 401，或用已存令牌调用 `rejectToken`，都会删除授权记录并发出 `deepseek-account/session-expired` 和 `deepseek-account/signed-out`。`signOut` 删除授权记录，发出 `deepseek-account/signed-out`，并在后台通过 `POST /api/agent/logout` 吊销设备；吊销失败不会恢复授权记录。

Peto Web 按每日 Agent 步数计量而非钱包：`getBalance` 不返回钱包，`getUnnotifiedBonuses` 不返回赠金，`ackBonusNotified` 返回 false，`getPlatformSession` 返回 null。账号链接指向服务器根地址，Peto Web 在那里打开自己的设置。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

设置中的账号卡片仍以 DeepSeek Platform 的布局呈现此投影。尚未显示 `/api/agent/me` 中的每日步数用量。
