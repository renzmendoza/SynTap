import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './index.css'
import App from './App.jsx'
import syntapIcon from './assets/syntap.png'

const favicon = document.querySelector('link[rel="icon"]')
if (favicon) {
  favicon.href = syntapIcon
  favicon.type = 'image/png'
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
