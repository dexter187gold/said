import React, { createContext, useContext, useMemo, useState, useEffect } from 'react'

const dict = {
  en: {
    dashboard: 'Dashboard', invoices: 'Invoices', quotes: 'Quotes', credits: 'Credit notes',
    clients: 'Clients', tickets: 'Tickets', documents: 'Documents', settings: 'Settings', about: 'About',
    sign_in: 'Sign in', register: 'Create account', email: 'Email', password: 'Password', save: 'Save',
    logout: 'Sign out', two_fa: 'Two-factor authentication', backup: 'Download backup',
    popia_export: 'Export my data (POPIA)', language: 'Language',
  },
  af: {
    dashboard: 'Kontroleskerm', invoices: 'Fakture', quotes: 'Kwotasies', credits: 'Kredietnotas',
    clients: 'Kliënte', tickets: 'Werkkaarte', documents: 'Dokumente', settings: 'Instellings', about: 'Oor',
    sign_in: 'Meld aan', register: 'Skep rekening', email: 'E-pos', password: 'Wagwoord', save: 'Stoor',
    logout: 'Meld af', two_fa: 'Twee-faktor-stawing', backup: 'Laai rugsteun af',
    popia_export: 'Voer my data uit (POPIA)', language: 'Taal',
  },
  zu: {
    dashboard: 'Idashboard', invoices: 'Ama-invoice', quotes: 'Ama-quote', credits: 'Ama-credit note',
    clients: 'Amakhasimende', tickets: 'Amathikithi', documents: 'Amadokhumenti', settings: 'Izilungiselelo', about: 'Mayelana',
    sign_in: 'Ngena', register: 'Bhalisa', email: 'I-imeyili', password: 'Iphasiwedi', save: 'Londoloza',
    logout: 'Phuma', two_fa: 'Ukuqinisekisa kwezinto ezimbili', backup: 'Landa isipele',
    popia_export: 'Khipha idatha yami (POPIA)', language: 'Ulimi',
  },
}

const I18nCtx = createContext(null)

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => localStorage.getItem('said_locale') || 'en')
  const setLocale = (l) => {
    const next = dict[l] ? l : 'en'
    localStorage.setItem('said_locale', next)
    setLocaleState(next)
    document.documentElement.lang = next === 'af' ? 'af' : next === 'zu' ? 'zu' : 'en'
  }
  useEffect(() => {
    document.documentElement.lang = locale === 'af' ? 'af' : locale === 'zu' ? 'zu' : 'en'
  }, [locale])
  const t = useMemo(() => {
    const d = dict[locale] || dict.en
    return (key) => d[key] || dict.en[key] || key
  }, [locale])
  return <I18nCtx.Provider value={{ locale, setLocale, t, locales: ['en', 'af', 'zu'] }}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nCtx)
  if (!ctx) throw new Error('useI18n outside provider')
  return ctx
}
