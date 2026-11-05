/** Peto: the shipped compositions send nothing to DeepSeek on their own; this fails if a merge restores a row. */

import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

/** Inserted rows of one bundle patch file, by id. */
function rows(file: string) {
  const inserted = loadOverlayPatches('peto-privacy', fileURLToPath(new URL(file, import.meta.url)))
    .flatMap(patch => patch.insert ?? [])
  return new Map(inserted.map(row => [row.id, row]))
}

it('keeps Session telemetry, Desktop product analytics and the DeepSeek questionnaire off', () => {
  const base = rows('../../base/cordis.patch.yml')
  const web = rows('../cordis.patch.yml')
  expect(base.get('session-telemetry-otel')?.disabled).toBe(true)
  expect(web.get('desktop-product-telemetry')?.disabled).toBe(true)
  expect(web.get('product-analytics')?.disabled).toBe(true)
  expect(web.get('ui-settings-account')?.config).toEqual({ contactFormUrl: '' })
})
