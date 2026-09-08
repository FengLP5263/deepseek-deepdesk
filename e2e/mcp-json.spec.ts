import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMemoryUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null
test.afterEach(async () => { await closeDeepDesk(ctx); ctx = null })

for (const [theme, scale] of [['light', 1], ['dark', 1.5]] as const) {
  test(`validates pasted and file MCP JSON without executing commands (${theme}, ${scale})`, async ({ browserName: _browserName }, testInfo) => {
    const dir = createMemoryUserData('http://127.0.0.1:1')
    const file = join(dir, 'deepdesk.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    state.settings = { ...state.settings, theme, appFontScale: scale }
    writeFileSync(file, JSON.stringify(state))
    ctx = await launchDeepDesk(dir)
    const { page, app } = ctx
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: 'MCP', exact: true }).click()
    await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
    const modal = page.locator('.modal')
    await modal.getByLabel('MCP JSON 配置').fill('{broken')
    await modal.getByRole('button', { name: '检查配置' }).click()
    await expect(modal.getByRole('alert')).toContainText('JSON 格式不正确')
    await expect(modal.getByRole('button', { name: '确认导入' })).toBeDisabled()
    const valid = JSON.stringify({ mcpServers: { '粘贴导入': { command: 'must-not-execute', args: ['test.js'], enabled: true } } }, null, 2)
    await modal.getByLabel('MCP JSON 配置').fill(valid)
    await modal.getByRole('button', { name: '检查配置' }).click()
    await expect(modal.getByRole('status')).toContainText('检查通过')
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`mcp-import-${theme}-${scale}.png`), animations: 'disabled' })
    await modal.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('.mcp-card', { hasText: '粘贴导入' })).toContainText('未连接')
    await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
    await modal.getByLabel('MCP JSON 配置').fill(valid)
    await modal.getByRole('button', { name: '检查配置' }).click()
    await expect(modal.getByRole('alert')).toContainText('同名服务器')
    const configFile = join(dir, 'import.json')
    writeFileSync(configFile, JSON.stringify({ servers: { '文件导入': { type: 'http', url: 'http://127.0.0.1:1/mcp' } } }))
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
    }, configFile)
    await modal.getByRole('button', { name: '选择 JSON 文件' }).click()
    await expect(modal.getByLabel('MCP JSON 配置')).toHaveValue(/文件导入/u)
    await modal.getByRole('button', { name: '检查配置' }).click()
    await modal.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('.mcp-card')).toHaveCount(2)
    expect((await page.evaluate(() => window.api.mcp.list())).every(server => !server.config.enabled && server.state === 'disconnected')).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`mcp-imported-${theme}-${scale}.png`) })
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(dir)
    const restored = await ctx.page.evaluate(() => window.api.mcp.list())
    expect(restored).toHaveLength(2)
    expect(restored.every(server => !server.config.enabled && server.state === 'disconnected')).toBe(true)
  })
}
