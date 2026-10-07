import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, setToken } from '../api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [setupComplete, setSetupComplete] = useState(true)
  const [toast, setToast] = useState(null)
  const [oauthConfig, setOauthConfig] = useState({ google_enabled: false, google_client_id: null })

  useEffect(() => {
    api('/api/v1/auth/oauth/config')
      .then((r) => setOauthConfig(r.data || {}))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('said_token')
    if (!t) {
      setReady(true)
      return
    }
    api('/api/v1/auth/me')
      .then((r) => {
        setUser(r.data)
        setSetupComplete(r.data.setup_complete !== false)
      })
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(id)
  }, [toast])

  const applyAuth = (data) => {
    setToken(data.token)
    setUser(data.user)
    setSetupComplete(data.setup_complete !== false)
    return data
  }

  const login = async (email, password) => {
    const r = await api('/api/v1/auth/login', { method: 'POST', body: { email, password } })
    return applyAuth(r.data)
  }

  const register = async (payload) => {
    return api('/api/v1/auth/register', { method: 'POST', body: payload })
  }

  const sendOtp = async (email, purpose = 'register') => {
    return api('/api/v1/auth/otp/send', { method: 'POST', body: { email, purpose } })
  }

  const verifyOtp = async (email, code, purpose = 'register') => {
    const r = await api('/api/v1/auth/otp/verify', { method: 'POST', body: { email, code, purpose } })
    return applyAuth(r.data)
  }

  const loginGoogle = async (id_token) => {
    const r = await api('/api/v1/auth/oauth/google', { method: 'POST', body: { id_token } })
    return applyAuth(r.data)
  }

  const completeSetup = async (company) => {
    const r = await api('/api/v1/auth/setup/company', { method: 'POST', body: company })
    setSetupComplete(true)
    return r.data
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    setSetupComplete(true)
  }

  const notify = (message, type = 'success') => setToast({ message, type })

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        setupComplete,
        oauthConfig,
        login,
        register,
        sendOtp,
        verifyOtp,
        loginGoogle,
        completeSetup,
        logout,
        toast,
        notify,
      }}
    >
      {children}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl px-4 py-2.5 text-sm text-white shadow-lg glass-panel ${
            toast.type === 'error' ? '!bg-red-600/90' : ''
          }`}
          style={toast.type !== 'error' ? { background: 'color-mix(in srgb, var(--said-accent) 90%, transparent)' } : undefined}
        >
          {toast.message}
        </div>
      )}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
