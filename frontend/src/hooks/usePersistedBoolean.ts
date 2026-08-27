import { useEffect, useState } from 'react'

function readStored(key: string, fallback: boolean) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return raw === '1' || raw === 'true'
  } catch {
    return fallback
  }
}

/** Boolean preference synced to localStorage (`1` / `0`). */
export function usePersistedBoolean(storageKey: string, defaultValue: boolean) {
  const [value, setValue] = useState(() => readStored(storageKey, defaultValue))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value ? '1' : '0')
    } catch {
      /* ignore quota / private mode */
    }
  }, [storageKey, value])

  return [value, setValue] as const
}
