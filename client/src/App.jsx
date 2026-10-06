import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Shell from './components/Shell'
import AppLogo from './components/AppLogo'
import Login from './pages/Login'
import Home from './pages/Home'
import Invoices from './pages/Invoices'
import InvoiceEdit from './pages/InvoiceEdit'
import Tickets from './pages/Tickets'
import Clients from './pages/Clients'
import Documents from './pages/Documents'

function Guard({ children }) {
  const { user, ready } = useAuth()
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 to-brand">
        <div className="text-center text-white">
          <AppLogo size={72} />
          <p className="mt-4 text-sm opacity-80">Loading SAID…</p>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/documents" element={<Documents />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Guard>
        }
      />
    </Routes>
  )
}
