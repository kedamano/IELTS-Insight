import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ui'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 契约 §15.1 外层：连 App 自己抛错也要有落点，否则整棵树被卸载 = 全白 */}
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
