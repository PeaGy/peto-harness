/** Peto: the shipped Web composition introduces the agent as Peto and drops the fixed DeepSeek Harness opener. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { dsh: { bundle: { patch: string[] } } }
const PERSONA = 'You are Peto, a coding agent powered by the {{model}} model. Introduce yourself to users as Peto; '
  + 'an agent name given in the runtime context only identifies you to other agents.'

/** The persona row config of an agent preset. */
interface PersonaConfig {
  prefix: string
  complete?: boolean
  includeRuntimeContext?: boolean
}

/** Every patch of the bundle, in application order. */
function bundlePatches(): Array<Record<string, unknown>> {
  return MANIFEST.dsh.bundle.patch.flatMap(file => loadOverlayPatches('peto-identity', join(PACKAGE_DIR, file)))
}

/** The persona row of each inserted agent preset, keyed by preset id. */
function presetPersonas(): Map<string, PersonaConfig> {
  const personas = new Map<string, PersonaConfig>()
  for (const patch of bundlePatches()) {
    const inserted = Array.isArray(patch['insert']) ? patch['insert'] as Array<Record<string, unknown>> : []
    for (const entry of inserted) {
      if (entry['name'] !== '@deepseek-ai/dsh-agent-preset') continue
      const config = entry['config'] as { id: string; plugins: Array<{ id: string; config?: PersonaConfig }> }
      const persona = config.plugins.find(plugin => plugin.id === 'persona')
      if (persona?.config !== undefined) personas.set(config.id, persona.config)
    }
  }
  return personas
}

it('names the deployment persona Peto without the harness opener', () => {
  const rows = bundlePatches().filter(patch => patch['id'] === 'system-prompt')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.['config']).toEqual({ includeHarnessIdentity: false, personaPrefix: PERSONA })
})

it('names every coding preset persona Peto', () => {
  const personas = presetPersonas()
  expect([...personas.keys()].sort()).toEqual(['cordis', 'minimal', 'ptc', 'standard'])
  for (const id of ['standard', 'ptc', 'cordis']) expect(personas.get(id)).toEqual({ prefix: PERSONA })
  // The minimal preset owns its complete prompt, which names no product.
  expect(personas.get('minimal')).toEqual({
    prefix: 'You are a helpful software engineer assistant.', complete: true, includeRuntimeContext: false,
  })
})
