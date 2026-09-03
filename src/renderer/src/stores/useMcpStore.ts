import { create } from 'zustand'
import type { McpActionResult, McpServerConfig, McpServerStatus } from '@shared/types'

interface McpState {
  loaded: boolean
  statuses: McpServerStatus[]
  load: () => Promise<void>
  save: (config: McpServerConfig) => Promise<McpServerStatus>
  remove: (id: string) => Promise<void>
  connect: (id: string) => Promise<McpActionResult>
  disconnect: (id: string) => Promise<McpActionResult>
}

function replaceStatus(statuses: McpServerStatus[], status?: McpServerStatus): McpServerStatus[] {
  if (!status) return statuses
  const index = statuses.findIndex(item => item.config.id === status.config.id)
  if (index < 0) return [...statuses, status]
  return statuses.map(item => item.config.id === status.config.id ? status : item)
}

export const useMcpStore = create<McpState>()((set, get) => ({
  loaded: false,
  statuses: [],
  load: async () => {
    const statuses = await window.api.mcp.list()
    set({ statuses, loaded: true })
  },
  save: async config => {
    const status = await window.api.mcp.save(config)
    set({ statuses: replaceStatus(get().statuses, status), loaded: true })
    return status
  },
  remove: async id => {
    await window.api.mcp.remove(id)
    set({ statuses: get().statuses.filter(item => item.config.id !== id) })
  },
  connect: async id => {
    const result = await window.api.mcp.connect(id)
    set({ statuses: replaceStatus(get().statuses, result.status) })
    return result
  },
  disconnect: async id => {
    const result = await window.api.mcp.disconnect(id)
    set({ statuses: replaceStatus(get().statuses, result.status) })
    return result
  }
}))
