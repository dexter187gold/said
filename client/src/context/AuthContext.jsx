import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, setToken } from '../api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const t = localStorage.getItem('said_token')
    if (!t) {
      setReady(true)
      return
    }
    api('/api/v1/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(id)
  }, [toast])

  const login = async (email, password) => {
    const r = await api('/api/v1/auth/login', { method: 'POST', body: { email, password } })
    setToken(r.data.token)
    setUser(r.data.user)
    return r.data.user
  }

  const register = async (payload) => {
    const r = await api('/api/v1/auth/register', { method: 'POST', body: payload })
    setToken(r.data.token)
    setUser(r.data.user)
    return r.data.user
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  const notify = (message, type = 'success') => setToast({ message, type })

  return (
    <AuthCtx.Provider value={{ user, ready, login, register, logout, toast, notify }}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-[100] rounded-xl px-4 py-2 text-sm text-white shadow-lg ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-brand'
          }`}
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
