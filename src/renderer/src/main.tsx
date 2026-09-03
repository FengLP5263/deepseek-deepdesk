import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/app.css'
import './assets/agent.css'
import './assets/session-search.css'

const rootEl = document.getElementById('root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
