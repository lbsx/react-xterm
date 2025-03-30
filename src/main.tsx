import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TerminalComponent from './Terminal'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TerminalComponent />
  </StrictMode>,
)
