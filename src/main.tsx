import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'
import { Toaster } from 'sonner'
import { PasswordGate } from '@/components/PasswordGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <PasswordGate>
        <App />
        </PasswordGate>
        <Toaster richColors position="top-right" />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
