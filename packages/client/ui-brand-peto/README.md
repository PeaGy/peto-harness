---
description: "Peto's solid brand mark for the sidebar and the home hero, drawn in the current text colour."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-peto

English | [中文](README.zh.md)

## Summary

Fill the brand slots with Peto's mark instead of DeepSeek's whale. The mark is the Welcome-screen Peto logo traced into one solid silhouette with its light highlights cut out, drawn in `currentColor`, so it follows the light and dark themes like the whale it replaces. The Peto Web and Desktop composition mounts this package in place of [dsh-client-ui-brand-official](../ui-brand-official/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The row takes no configuration. Every build gets the mark in `sidebar.brand.mark`, which the expanded sidebar and the collapsed rail both render, and in `conversation.hero.brand.mark`, the mark before the blank-home headline. A local build keeps the sidebar's own local-build label and version beside the mark. An `official` build (`DSH_CLIENT_BUILD_PROFILE=official`) also fills `sidebar.brand.name` with the product name, Peto Agent.

<a id="understand-the-implementation"></a>
## Understand the implementation

The mark is one even-odd path in a 138 × 94 view box (`src/client/mark.ts`). It was traced from Peto Web's `docs-assets/logo.webp` (144 × 100): the dark pink hair became the filled area, and only the large light regions (the two arms and the fringe) stay as cut-outs. Small highlights inside the hair were filled in, because at 24 px they read as noise. The component takes the requested width and keeps the ratio, as the whale did, and passes the host class through, so the home hero keeps its colour and hover sway.

The mark and the name install as one declaration-aware registration set in an `official` build, so HMR never leaves the Peto mark beside the local-build label. The node half is an empty Loader seat.

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One geometry** — the simplified mark is tuned for the 24–40 px slots; a larger slot would want the traced version with the hair highlights.
- **No home animation** — the official package's click-triggered whale is not replaced; the blank home stays still.
- **App icons are separate** — the window, taskbar, tray, installer and favicon images are not slots and still need their own Peto artwork.
