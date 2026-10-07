import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Shell from './components/Shell'
import AppLogo from './components/AppLogo'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Home from './pages/Home'
import Invoices from './pages/Invoices'
import InvoiceEdit from './pages/InvoiceEdit'
import Quotes from './pages/Quotes'
import Credits from './pages/Credits'
import Tickets from './pages/Tickets'
import Clients from './pages/Clients'
import Ageing from './pages/Ageing'
import Documents from './pages/Documents'
import Settings from './pages/Settings'
import TemplateDesigner from './pages/TemplateDesigner'
import About from './pages/About'
import Platform from './pages/Platform'
import Portal from './pages/Portal'
import Money from './pages/Money'

function Guard({ children }) {
  const { user, ready, setupComplete } = useAuth()
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <AppLogo size={72} />
          <p className="mt-4 text-sm opacity-80">Loading SAID…</p>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!setupComplete) return <Navigate to="/setup" replace />
  return children
}

function SetupGuard({ children }) {
  const { user, ready, setupComplete } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  if (setupComplete) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<SetupGuard><Setup /></SetupGuard>} />
      <Route path="/portal" element={<Portal />} />
      <Route
        path="/*"
        element={
          <Guard>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/invoices/new" element={<InvoiceEdit />} />
                <Route path="/invoices/:id" element={<InvoiceEdit />} />
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/new" element={<InvoiceEdit />} />
                <Route path="/quotes/:id" element={<InvoiceEdit />} />
                <Route path="/credits" element={<Credits />} />
                <Route path="/credits/new" element={<InvoiceEdit />} />
                <Route path="/credits/:id" element={<InvoiceEdit />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/ageing" element={<Ageing />} />
                <Route path="/money" element={<Money />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/documents/designer" element={<TemplateDesigner />} />
                <Route path="/documents/designer/:id" element={<TemplateDesigner />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/platform" element={<Platform />} />
                <Route path="/about" element={<About />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Guard>
        }
      />
    </Routes>
  )
}
