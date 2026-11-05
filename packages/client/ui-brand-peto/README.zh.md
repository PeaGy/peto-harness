---
description: "侧栏和首页主视觉中的 Peto 实心标志，按当前文字颜色绘制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-peto

[English](README.md) | 中文

## 概述

用 Peto 的标志替代 DeepSeek 的鲸鱼填充品牌插槽。标志取自欢迎页的 Peto 徽标，描成一个实心剪影，并把浅色高光镂空；它以 `currentColor` 绘制，因此和被替换的鲸鱼一样随浅色、深色主题变化。Peto 的 Web 与桌面组合用本包代替 [dsh-client-ui-brand-official](../ui-brand-official/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

该行无需配置。每种构建都会在 `sidebar.brand.mark`（展开的侧栏和收起的侧栏都会渲染）以及 `conversation.hero.brand.mark`（空白首页标题前的标志）中显示该标志。本地构建在标志旁保留侧栏自身的本地构建标签和版本号。`official` 构建（`DSH_CLIENT_BUILD_PROFILE=official`）还会在 `sidebar.brand.name` 中显示产品名 Peto Agent。

<a id="understand-the-implementation"></a>
## 了解实现

标志是 138 × 94 视图框中的一条 even-odd 路径（`src/client/mark.ts`）。它由 Peto Web 的 `docs-assets/logo.webp`（144 × 100）描出：深粉色头发成为填充区域，只有较大的浅色区域（两只手臂和刘海）保留为镂空。头发内部的小高光被填平，因为在 24 px 下它们看起来像噪点。组件按请求的宽度绘制并保持比例，与鲸鱼一致，并透传宿主类名，使首页主视觉保留其颜色和悬停摆动。

在 `official` 构建中，标志和名称作为一个感知声明的注册集合一起安装，因此热更新不会让 Peto 标志与本地构建标签并存。node 端是一个空的 Loader 座位。

<a id="model-experience"></a>
## 模型体验

无，本包只提供浏览器端展示；这里的内容不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有一套几何** — 简化后的标志针对 24–40 px 的插槽调整；更大的插槽需要保留头发高光的描绘版本。
- **没有首页动画** — 官方包中点击触发的鲸鱼没有被替换；空白首页保持静止。
- **应用图标另行处理** — 窗口、任务栏、托盘、安装程序和网站图标不是插槽，仍需各自的 Peto 图稿。
