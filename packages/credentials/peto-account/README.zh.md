---
description: "通过 Peto Agent 设备码登录 Peto Web，把设备令牌保存在本地凭据存储中，并读取账号的每日 Peto Agent 步数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-peto-account

[English](README.md) | 中文

## 概述

在应用中用设备码登录 Peto Web，无需 API Key。设备令牌保存在本机的凭据存储中，只发往配置的 Peto Web 服务器。登录后账号页显示 Peto 账号名称和今日的 Peto Agent 步数，Peto 模型路由和网页搜索都用该令牌鉴权。它通过同一个账号服务取代 DeepSeek Platform 登录，因此账号控制器和欢迎窗口无需改动。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

以 `deepseek-account` 条目 id 挂载，并把 `server` 设为 Peto Web 源。`server` 必须使用 HTTPS；只有在回环地址并设置 `allowLoopbackHttp: true` 时才接受 HTTP。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `server` | 必填 | 提供设备码流程和网关的 Peto Web 源 |
| `deviceName` | 主机名 | 此设备在 Peto Web「设置 → Peto Agent」中的名称 |
| `allowLoopbackHttp` | `false` | 开发时允许回环地址的 `server` 使用纯 HTTP |
| `requestTimeoutMs` | `30000` | 每个 Peto Web 请求的期限 |
| `attemptTimeoutMs` | `600000` | 一次登录尝试的上限 |

`startSignIn` 把设备名发送到 `POST /api/agent/device/start`，以批准页面发布 `waiting-browser`，并按服务器给出的间隔轮询 `POST /api/agent/device/token`。当服务器的 `verification_url` 携带同一代码时使用它作为批准页面，否则使用 `<server>/?agent_code=<code>`。批准后，通过授权接缝把 `{ version: 1, server, token, deviceId, deviceName, account }` 作为 `peto-account/default` 授权记录提交。在页面上拒绝会以 `cancelled` 结束尝试，代码过期则以 `expired` 结束。轮询期间连续最多三次连接中断或服务器错误会重试；再多一次则尝试失败。

`resolveToken(url)` 只为 `server` 上的 URL 返回令牌，因此只有 [Peto 模型路由及其搜索提供方](../../llm/llm-peto-account/README.zh.md) 会收到它。`server` 与配置不同的授权记录会在挂载时删除，且永不转发。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`getProfile` 和 `getBalance` 都读取 `GET /api/agent/me`；同一次刷新中的两个查询共用一个请求。资料以 `account` 名称作为名称、以设备 ID 作为账号 ID，读取失败时保留登录时保存的名称。Peto Web 按每日 Agent 步数计量而非钱包，因此就绪的余额不含钱包，只带一个可选的 `steps` 记录：已用步数和上限、来自 `steps_reset_at` 的重置时刻（较旧的服务器没有该字段）、今日 token 数，以及账号可用的每个模型每次请求的步数。读取失败或回答无法使用时，余额为失败。该读取返回 HTTP 401，或用已存令牌调用 `rejectToken`，都会删除授权记录并发出 `deepseek-account/session-expired` 和 `deepseek-account/signed-out`。

账号链接带有 `manageUrl`，即 `<server>/?settings=agent`，Peto Web 用它打开「设置 → Peto Agent」；账号页和额度提示据此显示 Peto 的布局。`signOut` 删除授权记录，发出 `deepseek-account/signed-out`，并在后台通过 `POST /api/agent/logout` 吊销设备。`getUnnotifiedBonuses` 不返回赠金，`ackBonusNotified` 返回 false，`getPlatformSession` 返回 null。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，设备令牌只影响 HTTP 鉴权，账号信息从不进入模型提示、会话日志或工具结果。

#### KV Cache 影响

模型请求前缀不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有钱包或充值** — Peto Web 按每日步数计量，因此 DeepSeek Platform 的用量和充值页面没有内容可显示；账号页改为链接到 Peto Web。
- **步数是快照** — 账号页显示的是上次刷新时 `/api/agent/me` 返回的内容，打开设置会触发刷新；之后消耗的步数在下次刷新时出现。
- **吊销尽力而为** — 登出时先删除本地授权记录；`POST /api/agent/logout` 失败时，该设备仍列在 Peto Web 中，直到用户在那里移除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
