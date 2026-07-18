import { readFile } from 'node:fs/promises'

const bundlePaths = ['dist-electron/main.js', 'dist-electron/preload.js']
const forbiddenMarkers = [
  'node_modules/electron/index.js',
  'Electron failed to install correctly',
]

for (const bundlePath of bundlePaths) {
  const bundle = await readFile(bundlePath, 'utf8')

  if (!/require\(["']electron["']\)/.test(bundle)) {
    throw new Error(`${bundlePath} does not load Electron at runtime`)
  }

  for (const marker of forbiddenMarkers) {
    if (bundle.includes(marker)) {
      throw new Error(`${bundlePath} contains bundled Electron marker: ${marker}`)
    }
  }
}

console.log('Electron bundle boundary verified')
