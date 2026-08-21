#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const node = process.platform === 'win32' ? 'node.exe' : 'node'

const help = `DeepDesk engineering flow

Usage:
  pnpm flow -- <command> [options]

Commands:
  doctor                         Print environment and project status
  ci [--include-build] [--include-smoke] [--include-e2e] [--continue-on-error]
                                 Run CI quality gate. Same as check, with CI-oriented naming
  check [--include-build] [--include-smoke] [--include-e2e] [--continue-on-error]
                                 Run quality gates: typecheck, lint, test, optional build/smoke/e2e
  e2e [--mode isolated|session|all]
                                 Run E2E tests. isolated is CI-friendly; session keeps one window open
  test [--kind unit|smoke|all]   Run tests. "unit"=vitest, "smoke"=Electron smoke, "all"=both
  seed-ui-session [--user-data-dir <dir>]
                                 Seed a persisted UI review mock session named UI会话
  build                          Run production build
  package --target win|mac|all
                                 Build platform package with electron-builder
  release --target win|mac
                                 Run full quality gate, then package target
  clean --out --release --temp [--dry-run]
                                 Remove selected generated artifacts

Examples:
  pnpm flow -- doctor
  pnpm flow -- check --include-build
  pnpm flow -- ci --include-build
  pnpm flow -- e2e
  pnpm flow -- e2e --mode session
  pnpm flow -- seed-ui-session
  pnpm flow -- test --kind smoke
  pnpm flow -- package --target win
  pnpm flow -- package --target mac
  pnpm flow -- release --target win
  pnpm flow -- release --target mac
`

function parseArgs(argv) {
  const flags = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) {
      flags.set(raw.slice(0, eq), raw.slice(eq + 1))
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags.set(raw, next)
      i++
    } else {
      flags.set(raw, true)
    }
  }
  return { positional, flags }
}

function flag(flags, name, fallback = false) {
  return flags.has(name) ? flags.get(name) : fallback
}

function run(command, args) {
  return new Promise((resolveRun) => {
    console.log(`\n$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
      shell: process.platform === 'win32'
    })
    child.on('close', code => resolveRun(code ?? 1))
    child.on('error', error => {
      console.error(error)
      resolveRun(1)
    })
  })
}

async function runSteps(steps, continueOnError = false) {
  const failed = []
  for (const step of steps) {
    const code = await run(step.command, step.args)
    if (code !== 0) {
      failed.push({ name: step.name, code })
      if (!continueOnError) break
    }
  }
  if (failed.length > 0) {
    console.error('\nFailed steps:')
    for (const item of failed) console.error(`- ${item.name}: exit ${item.code}`)
    return 1
  }
  console.log('\nFlow completed successfully.')
  return 0
}

async function doctor() {
  const checks = [
    ['package.json', existsSync(join(root, 'package.json'))],
    ['AGENTS.md', existsSync(join(root, 'AGENTS.md'))],
    ['electron-builder.yml', existsSync(join(root, 'electron-builder.yml'))],
    ['vitest.config.ts', existsSync(join(root, 'vitest.config.ts'))],
    ['playwright.config.ts', existsSync(join(root, 'playwright.config.ts'))],
    ['e2e tests', existsSync(join(root, 'e2e'))],
    ['project skill', existsSync(join(root, '.agents', 'skills', 'deepdesk-engineering', 'SKILL.md'))]
  ]
  console.log('DeepDesk engineering doctor')
  console.log(`root: ${root}`)
  console.log(`platform: ${process.platform}`)
  console.log(`node: ${process.version}`)
  console.log(`pnpm executable: ${pnpm}`)
  for (const [name, ok] of checks) console.log(`${ok ? 'OK ' : 'MISS'} ${name}`)
  return run(pnpm, ['--version'])
}

function checkSteps(flags) {
  const steps = [
    { name: 'typecheck', command: pnpm, args: ['typecheck'] },
    { name: 'typecheck:e2e', command: pnpm, args: ['typecheck:e2e'] },
    { name: 'lint', command: pnpm, args: ['lint'] },
    { name: 'test', command: pnpm, args: ['test'] }
  ]
  if (flag(flags, 'include-build')) steps.push({ name: 'build', command: pnpm, args: ['build'] })
  if (flag(flags, 'include-smoke')) steps.push({ name: 'smoke', command: pnpm, args: ['smoke'] })
  if (flag(flags, 'include-e2e')) steps.push({ name: 'e2e', command: node, args: ['scripts/flow.mjs', 'e2e'] })
  return steps
}

function testSteps(kind) {
  if (kind === 'unit') return [{ name: 'test', command: pnpm, args: ['test'] }]
  if (kind === 'smoke') return [{ name: 'smoke', command: pnpm, args: ['smoke'] }]
  if (kind === 'all') return [
    { name: 'test', command: pnpm, args: ['test'] },
    { name: 'smoke', command: pnpm, args: ['smoke'] }
  ]
  throw new Error(`Invalid --kind: ${kind}`)
}

function seedUiSessionSteps(flags) {
  const args = ['scripts/seed-ui-session.mjs']
  const userDataDir = flag(flags, 'user-data-dir', '')
  if (userDataDir) args.push('--user-data-dir', String(userDataDir))
  return [{ name: 'seed-ui-session', command: node, args }]
}

function e2eArgs(mode) {
  if (mode === 'isolated') return ['exec', 'playwright', 'test', 'e2e/app.spec.ts']
  if (mode === 'session') return ['exec', 'playwright', 'test', 'e2e/session.spec.ts']
  if (mode === 'all') return ['exec', 'playwright', 'test']
  throw new Error(`Invalid --mode: ${mode}`)
}

async function e2e(flags) {
  const playwrightConfig = join(root, 'playwright.config.ts')
  const e2eDir = join(root, 'e2e')
  if (!existsSync(playwrightConfig) || !existsSync(e2eDir)) {
    console.error('E2E is not installed yet.')
    console.error('Read docs/e2e.md, then add Playwright Electron or WebdriverIO in a dedicated setup change.')
    return 1
  }
  const mode = String(flag(flags, 'mode', 'isolated'))
  return runSteps([
    { name: 'build', command: pnpm, args: ['build'] },
    { name: `e2e:${mode}`, command: pnpm, args: e2eArgs(mode) }
  ])
}

function packageSteps(target) {
  const allowed = ['win', 'mac']
  const targets = target === 'all' ? allowed : [target]
  for (const item of targets) {
    if (!allowed.includes(item)) throw new Error(`Invalid --target: ${target}`)
  }
  if (targets.includes('mac') && process.platform !== 'darwin') {
    console.warn('Warning: electron-builder can only build macOS packages on macOS.')
  }
  return targets.map(item => ({ name: `package:${item}`, command: pnpm, args: [`package:${item}`] }))
}

function clean(flags) {
  const targets = []
  if (flag(flags, 'out')) targets.push('out')
  if (flag(flags, 'release')) targets.push('release')
  if (flag(flags, 'temp')) targets.push('tmp_lark_auth_contact_im.png')
  if (targets.length === 0) {
    console.error('clean requires at least one explicit flag: --out, --release, or --temp')
    return 1
  }
  for (const item of targets) {
    const target = join(root, item)
    if (!existsSync(target)) {
      console.log(`skip missing ${item}`)
      continue
    }
    if (flag(flags, 'dry-run')) {
      console.log(`would remove ${item}`)
      continue
    }
    rmSync(target, { recursive: true, force: true })
    console.log(`removed ${item}`)
  }
  return 0
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional[0] ?? 'help'
  try {
    if (command === 'help' || flag(flags, 'help')) {
      console.log(help)
      return 0
    }
    if (command === 'doctor') return doctor()
    if (command === 'ci') return runSteps(checkSteps(flags), Boolean(flag(flags, 'continue-on-error')))
    if (command === 'check') return runSteps(checkSteps(flags), Boolean(flag(flags, 'continue-on-error')))
    if (command === 'e2e') return e2e(flags)
    if (command === 'test') return runSteps(testSteps(String(flag(flags, 'kind', 'unit'))))
    if (command === 'seed-ui-session') return runSteps(seedUiSessionSteps(flags))
    if (command === 'build') return runSteps([{ name: 'build', command: pnpm, args: ['build'] }])
    if (command === 'package') return runSteps(packageSteps(String(flag(flags, 'target', 'win'))))
    if (command === 'release') {
      const target = String(flag(flags, 'target', 'win'))
      const steps = [
        ...checkSteps(new Map([['include-build', true], ['include-smoke', true]])),
        { name: 'e2e', command: node, args: ['scripts/flow.mjs', 'e2e'] },
        ...packageSteps(target)
      ]
      return runSteps(steps)
    }
    if (command === 'clean') return clean(flags)
    console.error(`Unknown command: ${command}`)
    console.log(help)
    return 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

process.exitCode = await main()
