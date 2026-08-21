import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tsx = readFileSync(join(root, 'src/renderer/src/components/DeepSeekLogo.tsx'), 'utf8')
const m = /d='([^']+)'/.exec(tsx)
if (!m) throw new Error('whale path not found')
const whale = m[1]

function icon(size) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 50 50"><rect width="50" height="50" rx="11" fill="#ffffff"/><g transform="translate(7.5 7.5) scale(0.7)"><path d="' + whale + '" fill="#000000" fill-rule="nonzero"/></g></svg>'
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
}

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), icon(512))

if (process.platform === 'darwin') {
  execFileSync('sips', ['-s', 'format', 'icns', join(root, 'build', 'icon.png'), '--out', join(root, 'build', 'icon.icns')])
  console.log('icon.png and icon.icns written')
} else {
  console.log('icon.png written; icon.icns generation requires macOS')
}
