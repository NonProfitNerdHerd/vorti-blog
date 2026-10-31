'use client'
import { useEffect, useState } from 'react'
import { currencyExponent, defaultCurrencyConfig, type CurrencyConfig } from './currency-config'

export function useCurrencies(api: string, site: string) {
  const [config, setConfig] = useState<CurrencyConfig>(defaultCurrencyConfig)
  useEffect(() => {
    if (!site) return
    const controller = new AbortController()
    fetch(`${api}/crm/currencies?${new URLSearchParams({ site })}`, { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Currency settings are unavailable.')
        return response.json() as Promise<CurrencyConfig>
      }).then(setConfig).catch(() => {})
    return () => controller.abort()
  }, [api, site])
  return { ...config, exponent: currencyExponent }
}
