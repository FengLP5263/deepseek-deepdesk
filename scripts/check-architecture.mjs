#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)

function valueOf(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const root = resolve(valueOf('--root', scriptRoot))
const configPath = resolve(valueOf('--config', join(root, 'scripts', 'architecture-budget.json')))
const scanRoots = ['src', 'scripts', 'tests', 'e2e']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css'])
const importExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

if (!existsSync(configPath)) {
  console.error(`Architecture budget is missing: ${configPath}`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const failures = []
const notices = []

function portable(path) {
  return path.split(sep).join('/')
}

function collectFiles(directory, files = []) {
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'release' || entry.name.startsWith('.')) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(absolute, files)
    else if (sourceExtensions.has(extname(entry.name))) files.push(absolute)
  }
  return files
}

function lineCount(text) {
  if (!text) return 0
  const lines = text.split(/\r?\n/u).length
  return /\r?\n$/u.test(text) ? lines - 1 : lines
}

function categoryOf(file) {
  const path = portable(relative(root, file))
  if (path.endsWith('.css')) return 'stylesheet'
  if (path.startsWith('tests/') || path.startsWith('e2e/') || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return 'test'
  if (path.startsWith('scripts/')) return 'script'
  if (path.includes('/components/') && path.endsWith('.tsx')) return 'component'
  if (path.includes('/stores/')) return 'store'
  if (path.startsWith('src/main/')) return 'service'
  return 'source'
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/u).length
}

function layerOf(file) {
  const path = portable(relative(root, file))
  if (path.startsWith('src/renderer/')) return 'renderer'
  if (path.startsWith('src/shared/')) return 'shared'
  if (path.startsWith('src/main/')) return 'main'
  if (path.startsWith('src/preload/')) return 'preload'
  return null
}

function resolvedLayer(file, specifier) {
  if (specifier.startsWith('@shared/')) return 'shared'
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) return null
  const target = portable(resolve(dirname(file), specifier))
  const rootPath = portable(root) + '/src/'
  if (!target.startsWith(rootPath)) return null
  const relativeTarget = target.slice(rootPath.length)
  return relativeTarget.split('/')[0] ?? null
}

function importsOf(text) {
  const imports = []
  const pattern = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu
  for (const match of text.matchAll(pattern)) imports.push({ specifier: match[1], index: match.index ?? 0 })
  return imports
}

function checkBoundaries(file, text) {
  const layer = layerOf(file)
  if (!layer) return
  const path = portable(relative(root, file))
  const nodeModules = /^(?:electron|node:|fs(?:\/|$)|path(?:\/|$)|child_process(?:\/|$)|http(?:\/|$)|https(?:\/|$)|net(?:\/|$)|tls(?:\/|$)|axios(?:\/|$))/u
  for (const item of importsOf(text)) {
    const targetLayer = resolvedLayer(file, item.specifier)
    const at = `${path}:${lineOf(text, item.index)}`
    if (layer === 'renderer' && nodeModules.test(item.specifier)) failures.push(`${at} renderer 禁止导入主进程/Node 网络与文件模块：${item.specifier}`)
    if (layer === 'renderer' && targetLayer === 'main') failures.push(`${at} renderer 禁止直接依赖 main`)
    if (layer === 'shared' && (targetLayer === 'main' || targetLayer === 'renderer')) failures.push(`${at} shared 禁止反向依赖 ${targetLayer}`)
    if (layer === 'main' && targetLayer === 'renderer') failures.push(`${at} main 禁止依赖 renderer`)
  }
  if (layer !== 'renderer') return
  const directNetwork = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/gu
  for (const match of text.matchAll(directNetwork)) {
    failures.push(`${path}:${lineOf(text, match.index ?? 0)} renderer 禁止直接发起网络请求；请通过 preload IPC 交给主进程`)
  }
}

const files = scanRoots.flatMap(directory => collectFiles(join(root, directory)))
for (const file of files) {
  const path = portable(relative(root, file))
  const text = readFileSync(file, 'utf8')
  const category = categoryOf(file)
  const limit = Number(config.limits?.[category])
  const exception = config.exceptions?.[path]
  const allowed = Number(exception?.maxLines ?? limit)
  const lines = lineCount(text)
  if (!Number.isFinite(allowed)) failures.push(`${path} 没有 ${category} 类型的行数预算`)
  else if (lines > allowed) failures.push(`${path} 为 ${lines} 行，超过 ${category} 预算 ${allowed} 行`)
  else if (exception) notices.push(`${path}: ${lines}/${allowed} 行（目标 ${exception.targetLines}）`)
  if (importExtensions.has(extname(file))) checkBoundaries(file, text)
}

for (const path of Object.keys(config.exceptions ?? {})) {
  if (!existsSync(join(root, path))) failures.push(`架构预算例外指向不存在的文件：${path}`)
}

if (failures.length > 0) {
  console.error('Architecture guard failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Architecture guard passed (${files.length} files).`)
if (notices.length > 0) {
  console.log('Legacy files are frozen at their current budget:')
  for (const notice of notices) console.log(`- ${notice}`)
}
