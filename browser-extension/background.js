const PORT_START = 32180
const PORT_END = 32189
const DEBUG_PROTOCOL_VERSION = '1.3'

let socket = null
let connectedPort = 0
let reconnectTimer = null
const attachedTabs = new Set()

function notifyStatus() {
  void chrome.runtime.sendMessage({ type: 'bridge-status', connected: socket?.readyState === WebSocket.OPEN, port: connectedPort }).catch(() => {})
}

function send(value) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function scheduleReconnect(delay = 1200) {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => connectToPort(PORT_START), delay)
}

function detachAllTabs() {
  for (const tabId of attachedTabs) {
    chrome.debugger.detach({ tabId }, () => void chrome.runtime.lastError)
  }
  attachedTabs.clear()
}

function connectToPort(port) {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  const candidate = new WebSocket(`ws://127.0.0.1:${port}/extension`)
  socket = candidate
  candidate.onopen = () => {
    connectedPort = port
    send({ type: 'hello' })
    notifyStatus()
  }
  candidate.onmessage = event => {
    void handleBridgeMessage(event.data)
  }
  candidate.onerror = () => candidate.close()
  candidate.onclose = () => {
    if (socket !== candidate) return
    socket = null
    connectedPort = 0
    detachAllTabs()
    notifyStatus()
    if (port < PORT_END) setTimeout(() => connectToPort(port + 1), 120)
    else scheduleReconnect()
  }
}

function chromeCall(run) {
  return new Promise((resolve, reject) => {
    run(result => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(result)
    })
  })
}

async function ensureDebugger(tabId) {
  if (attachedTabs.has(tabId)) return
  await chromeCall(done => chrome.debugger.attach({ tabId }, DEBUG_PROTOCOL_VERSION, done))
  attachedTabs.add(tabId)
}

async function listTabs() {
  const tabs = await chromeCall(done => chrome.tabs.query({ windowType: 'normal' }, done))
  return tabs
    .filter(tab => Number.isInteger(tab.id) && tab.id > 0)
    .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)))
    .map(tab => ({ id: tab.id, title: tab.title || '未命名页面', url: tab.url || '' }))
}

async function createTab(url) {
  const tab = await chromeCall(done => chrome.tabs.create({ url, active: true }, done))
  return { id: tab.id, title: tab.title || '新标签页', url: tab.url || url }
}

async function sendCdpCommand(tabId, method, params) {
  await ensureDebugger(tabId)
  return await chromeCall(done => chrome.debugger.sendCommand({ tabId }, method, params || {}, done))
}

async function handleBridgeMessage(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (message?.type !== 'request' || typeof message.id !== 'string') return
  try {
    let result
    if (message.action === 'tabs') result = { tabs: await listTabs() }
    else if (message.action === 'create-tab') result = { tab: await createTab(String(message.url || 'about:blank')) }
    else if (message.action === 'cdp') result = await sendCdpCommand(Number(message.tabId), String(message.method || ''), message.params)
    else if (message.action === 'detach-all') { detachAllTabs(); result = {} }
    else throw new Error('未知的 DeepDesk 浏览器请求')
    send({ type: 'response', id: message.id, ok: true, result })
  } catch (error) {
    send({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return
  send({ type: 'event', tabId: source.tabId, method, params })
})

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId) attachedTabs.delete(source.tabId)
})

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'get-bridge-status') return false
  respond({ connected: socket?.readyState === WebSocket.OPEN, port: connectedPort })
  return false
})

chrome.alarms.create('deepdesk-bridge-keepalive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'deepdesk-bridge-keepalive') return
  if (socket?.readyState === WebSocket.OPEN) send({ type: 'ping' })
  else connectToPort(PORT_START)
})

connectToPort(PORT_START)
