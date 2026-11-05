import OTel from '@deepseek-ai/dsh-otel'
/**
 * Peto: Desktop product analytics and their exporter stay off in every profile, because the exporter's only
 * destination is DeepSeek's collector. The pipeline itself is covered by its packages' own tests.
 */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Telemetry from '@deepseek-ai/dsh-host-product-telemetry-otel'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import { expect, it, onTestFinished, vi } from 'vitest'

it.each(['desktop', 'web'])('keeps product analytics and their exporter off: %s', async (profile) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  const identity = vi.fn().mockResolvedValue(undefined)
  ctx.provide('deepseekAccount', { getDeviceIdentity: identity } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  const rows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  expect(rows.map(row => row.id)).toEqual(['desktop-product-telemetry', 'product-analytics'])
  await ctx.loader.root.update(rows.map(row => ({
    ...row, name: row.id === 'desktop-product-telemetry' ? 'cordis:telemetry' : 'cordis:analytics',
  })))
  await ctx.loader.await()
  expect(ctx.loader.resolve('desktop-product-telemetry').disabled).toBe(true)
  expect(ctx.loader.resolve('product-analytics').disabled).toBe(true)
  expect(ctx.get('productTelemetry')).toBeUndefined()
  expect(ctx.get('productAnalytics')).toBeUndefined()
  expect(identity).not.toHaveBeenCalled()
})
