import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/renderer/src/assets/deepdesk-owl.png')).toString('base64')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><clipPath id="rounded"><rect width="1024" height="1024" rx="240"/></clipPath></defs><image width="1024" height="1024" clip-path="url(#rounded)" href="data:image/png;base64,${source}"/></svg>`

function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

function chunk(type, png) {
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([header, png])
}

const parts = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
  .map(([type, size]) => chunk(type, render(size)))
const header = Buffer.alloc(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(8 + parts.reduce((total, part) => total + part.length, 0), 4)
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), render(512))
writeFileSync(join(root, 'build', 'icon.icns'), Buffer.concat([header, ...parts]))
console.log('icon.png and icon.icns written')
