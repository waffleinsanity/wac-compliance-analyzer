import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, isUnauthorizedError, setToken, type User } from './api'

type AuthContextValue = {
  user: User | null
  loading: boolean
  /** True when a token exists but /me could not be confirmed (network/deploy blip). */
  sessionPending: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, email: string, inviteCode?: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ME_RETRY_DELAYS_MS = [0, 400, 1000, 2000]

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionPending, setSessionPending] = useState(false)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setSessionPending(false)
      setLoading(false)
      return
    }

    setLoading(true)
    let lastError: unknown = null

    for (const delay of ME_RETRY_DELAYS_MS) {
      if (delay) await sleep(delay)
      try {
        const me = await api.me()
        setUser(me)
        setSessionPending(false)
        setLoading(false)
        return
      } catch (err) {
        lastError = err
        if (isUnauthorizedError(err)) {
          setToken(null)
          setUser(null)
          setSessionPending(false)
          setLoading(false)
          return
        }
        // Network / 5xx / deploy blip — keep token and retry
      }
    }

    // Token kept; do not treat as logged out
    void lastError
    setSessionPending(Boolean(getToken()))
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password)
      setToken(res.access_token)
      await refresh()
    },
    [refresh],
  )

  const register = useCallback(
    async (username: string, password: string, email: string, inviteCode?: string) => {
      const res = await api.register(username, password, email, inviteCode)
      setToken(res.access_token)
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setSessionPending(false)
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionPending,
      login,
      register,
      logout,
      refresh,
    }),
    [user, loading, sessionPending, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
