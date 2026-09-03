const status = document.getElementById('status')

function render(state) {
  const connected = Boolean(state?.connected)
  status.textContent = connected ? '已连接到 DeepDesk' : '等待 DeepDesk 桌面客户端'
  status.classList.toggle('connected', connected)
}

chrome.runtime.sendMessage({ type: 'get-bridge-status' }).then(render).catch(() => render(null))
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'bridge-status') render(message)
})
