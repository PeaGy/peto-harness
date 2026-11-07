/**
 * Peto: gather the GitHub Release files of one unsigned Windows build.
 *
 * electron-builder names the installer `deepseek-harness-<version>-win-x64-unsigned.exe` and writes the update metadata
 * `stable.yml` beside it. A Peto release publishes the same bytes as `Peto-Agent-Setup-<version>-x64.exe`, so this
 * copies the installer and its blockmap under that name and rewrites the metadata to point at it. Peto Web serves the
 * metadata as the update feed (`peto-update-feed.mjs`); the updater fetches `<installer>.blockmap` beside the installer
 * for differential downloads. The installer's SHA-512 and size are checked against the metadata before anything is
 * written, and existing files are never overwritten.
 *
 * Usage: node --import tsx apps/desktop/scripts/peto-release-assets.ts <build version>
 */

import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dump, load } from 'js-yaml'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

/** Metadata file of the channel Peto builds embed. */
export const PETO_METADATA_FILENAME = 'stable.yml'

/** Files written for one release, in upload order. */
export interface PetoReleaseAssets {
  readonly directory: string
  readonly installer: string
  readonly blockmap: string
  readonly metadata: string
}

/**
 * Name the installer a Peto release publishes.
 * @param version Build version.
 * @returns Installer filename.
 */
export function petoInstallerFilename(version: string): string {
  return `Peto-Agent-Setup-${version}-x64.exe`
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`peto release: ${name} must be a mapping`)
  }
  return value as Record<string, unknown>
}

/**
 * Copy one build's installer, blockmap and rewritten metadata into a new release directory.
 * @param version Build version that the packaging run published.
 * @param artifacts Directory holding the unsigned artifacts and `stable.yml`.
 * @param output Parent directory; the files go to `<output>/<version>`.
 * @returns Paths of the written files.
 */
export async function preparePetoReleaseAssets(
  version: string,
  artifacts: string,
  output: string,
): Promise<PetoReleaseAssets> {
  const metadata = record(load(await readFile(join(artifacts, PETO_METADATA_FILENAME), 'utf8')), PETO_METADATA_FILENAME)
  if (metadata.version !== version) {
    throw new Error(`peto release: ${PETO_METADATA_FILENAME} describes ${String(metadata.version)}, not ${version}; package this version first`)
  }
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) throw new Error(`peto release: ${PETO_METADATA_FILENAME} must list one file`)
  const file = record(metadata.files[0], `${PETO_METADATA_FILENAME}.files[0]`)
  const built = `deepseek-harness-${version}-win-x64-unsigned.exe`
  if (file.url !== built) throw new Error(`peto release: ${PETO_METADATA_FILENAME} points at ${String(file.url)}, expected ${built}`)
  const source = join(artifacts, built)
  const size = (await stat(source)).size
  if (file.size !== size || file.sha512 !== await sha512(source)) {
    throw new Error(`peto release: ${built} does not match ${PETO_METADATA_FILENAME}; repackage instead of editing artifacts`)
  }
  const blockmapSource = `${source}.blockmap`
  await stat(blockmapSource)

  const directory = join(output, version)
  await mkdir(directory, { recursive: true })
  const name = petoInstallerFilename(version)
  const assets = {
    directory,
    installer: join(directory, name),
    blockmap: join(directory, `${name}.blockmap`),
    metadata: join(directory, PETO_METADATA_FILENAME),
  }
  await copyFile(source, assets.installer, constants.COPYFILE_EXCL)
  await copyFile(blockmapSource, assets.blockmap, constants.COPYFILE_EXCL)
  const published = { ...metadata, files: [{ ...file, url: name }], ...metadata.path === undefined ? {} : { path: name } }
  // One line per value, as electron-builder writes it.
  await writeFile(assets.metadata, dump(published, { lineWidth: -1 }), { flag: 'wx' })
  return assets
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const version = process.argv[2]
  if (version === undefined || process.argv.length !== 3) {
    process.stderr.write('usage: node --import tsx apps/desktop/scripts/peto-release-assets.ts <build version>\n')
    process.exit(2)
  }
  const paths = desktopTargetBuildPaths('win-x64')
  const assets = await preparePetoReleaseAssets(version, paths.unsignedArtifacts, join(paths.root, 'peto-release'))
  process.stdout.write(`peto release: upload these files to GitHub Release v${version}:\n`
    + `  ${assets.installer}\n  ${assets.blockmap}\n  ${assets.metadata}\n`)
}
