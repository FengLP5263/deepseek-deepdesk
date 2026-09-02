import { expect, test } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMultiProviderUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null
let retainedDirectory = ''

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  if (retainedDirectory) rmSync(retainedDirectory, { recursive: true, force: true })
  ctx = null
  retainedDirectory = ''
})

test('protects persisted provider keys with Windows safeStorage', async () => {
  test.skip(process.platform !== 'win32', 'DPAPI storage assertion is Windows-specific')
  retainedDirectory = createMultiProviderUserData('http://127.0.0.1:1')
  ctx = await launchDeepDesk(retainedDirectory)
  await expect(ctx.page.getByText('DeepDesk', { exact: true }).first()).toBeVisible()
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = null

  const persisted = readFileSync(`${retainedDirectory}/deepdesk.json`, 'utf8')
  expect(persisted).toContain('deepdesk:encrypted:v1:')
  expect(persisted).not.toContain('sk-mock')
  expect(persisted).not.toContain('sk-zhipu')
})
