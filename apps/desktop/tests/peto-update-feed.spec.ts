import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { resolvePetoUpdateFeed } from '../scripts/peto-update-feed.mjs'
import { petoInstallerFilename, preparePetoReleaseAssets } from '../scripts/peto-release-assets.ts'

const POLICY = { DSH_DESKTOP_AUTO_UPDATE_ENV: 'production', DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://peto.example.com' }

describe('Peto update feed', () => {
  it('points unsigned Windows builds at the policy origin on the stable channel', () => {
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.peto', DSH_DESKTOP_UNSIGNED: '1', ...POLICY }, 'win32', 'x64')
    expect(config.publish).toEqual([{ provider: 'generic', url: 'https://peto.example.com/api/agent/desktop/update/win-x64/', channel: 'stable' }])
    expect(config.extraMetadata).toMatchObject({ dshDesktopUpdateChannel: 'stable', dshMandatoryUpdatePolicy: { origin: 'https://peto.example.com' } })
    expect(config.win.signtoolOptions.publisherName).toBeUndefined()
    expect(JSON.stringify(config.publish)).not.toContain('deepseek.com')
  })

  it('keeps an explicit channel and leaves macOS and policy-less builds without a feed', () => {
    expect(resolvePetoUpdateFeed({ origin: 'https://peto.example.com' }, { DSH_DESKTOP_UPDATE_CHANNEL: 'nightly' }, 'win32', 'x64'))
      .toEqual({ channel: 'nightly', target: 'win-x64', publicUrl: 'https://peto.example.com/api/agent/desktop/update/win-x64/' })
    expect(resolvePetoUpdateFeed({ origin: 'https://peto.example.com' }, {}, 'darwin', 'arm64')).toBeUndefined()
    expect(resolvePetoUpdateFeed(undefined, {}, 'win32', 'x64')).toBeUndefined()
    const mac = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.peto', DSH_DESKTOP_UNSIGNED: '1', ...POLICY }, 'darwin', 'arm64')
    expect(mac.publish).toBeNull()
  })
})

describe('Peto release assets', () => {
  const version = '0.2.2-rc.1.20261107.1'
  const built = `deepseek-harness-${version}-win-x64-unsigned.exe`
  let root: string | undefined

  afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }) })

  async function artifacts(content = 'installer bytes', metadata?: (sha512: string, size: number) => string): Promise<string> {
    root = await mkdtemp(join(tmpdir(), 'peto-release-'))
    const directory = join(root, 'artifacts')
    await mkdir(directory)
    await writeFile(join(directory, built), content)
    await writeFile(join(directory, `${built}.blockmap`), 'blockmap')
    const sha512 = createHash('sha512').update(content).digest('base64')
    await writeFile(join(directory, 'stable.yml'), metadata?.(sha512, content.length)
      ?? `version: ${version}\nfiles:\n  - url: ${built}\n    sha512: ${sha512}\n    size: ${content.length}\npath: ${built}\nsha512: ${sha512}\nreleaseDate: '2026-11-07T01:00:00.000Z'\n`)
    return directory
  }

  it('renames the installer and blockmap and points the metadata at the published name', async () => {
    const directory = await artifacts()
    const assets = await preparePetoReleaseAssets(version, directory, join(root!, 'out'))
    const name = petoInstallerFilename(version)
    expect(name).toBe('Peto-Agent-Setup-0.2.2-rc.1.20261107.1-x64.exe')
    expect(await readFile(assets.installer, 'utf8')).toBe('installer bytes')
    expect(await readFile(assets.blockmap, 'utf8')).toBe('blockmap')
    const metadata = load(await readFile(assets.metadata, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({ version, path: name, releaseDate: '2026-11-07T01:00:00.000Z' })
    expect(metadata.files).toEqual([{ url: name, sha512: createHash('sha512').update('installer bytes').digest('base64'), size: 15 }])
    await expect(preparePetoReleaseAssets(version, directory, join(root!, 'out'))).rejects.toThrow(/EEXIST/u)
  })

  it('refuses metadata of another version or an installer that does not match it', async () => {
    const other = await artifacts()
    await expect(preparePetoReleaseAssets('0.2.2-rc.1.20261107.2', other, join(root!, 'out'))).rejects.toThrow(/package this version first/u)
    await rm(root!, { recursive: true, force: true })
    const tampered = await artifacts('installer bytes', (_sha512, size) =>
      `version: ${version}\nfiles:\n  - url: ${built}\n    sha512: ${'A'.repeat(86)}==\n    size: ${size}\n`)
    await expect(preparePetoReleaseAssets(version, tampered, join(root!, 'out'))).rejects.toThrow(/does not match/u)
  })
})
