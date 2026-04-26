import { supabase } from './supabase'

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocal 
  ? 'http://localhost:3001' 
  : (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
    correlationId?: string
  }
}

export class ApiError extends Error {
  code?: string
  retryable?: boolean
  correlationId?: string
  status: number

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload?.error?.code
    this.retryable = payload?.error?.retryable
    this.correlationId = payload?.error?.correlationId
  }
}

export function buildApiUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const base = API_BASE_URL || window.location.origin
  const url = new URL(normalizedPath, base)

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

async function getAccessToken(forceRefresh = false) {
  try {
    let { data: { session } } = await supabase.auth.getSession()
    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0
    const expiresSoon = expiresAt > 0 && expiresAt - Date.now() < 60_000

    if (forceRefresh || expiresSoon) {
      const { data, error } = await supabase.auth.refreshSession()
      if (!error && data.session) {
        session = data.session
      }
    }

    return session?.access_token || null
  } catch {
    return null
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  const finalInit = { ...init }
  const headers = new Headers(finalInit.headers || {})
  
  // Se for ngrok, adiciona o header para pular a tela de aviso
  if (API_BASE_URL.includes('ngrok-free.dev')) {
    headers.set('ngrok-skip-browser-warning', 'true')
  }

  const hasCustomAuth = headers.has('Authorization')
  const accessToken = hasCustomAuth ? null : await getAccessToken()
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  
  finalInit.headers = headers

  const url = buildApiUrl(path, query)
  let response = await fetch(url, finalInit)

  if (response.status === 401 && !hasCustomAuth) {
    const refreshedToken = await getAccessToken(true)
    if (refreshedToken && refreshedToken !== accessToken) {
      const retryHeaders = new Headers(headers)
      retryHeaders.set('Authorization', `Bearer ${refreshedToken}`)
      response = await fetch(url, { ...finalInit, headers: retryHeaders })
    }
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : null

  if (!response.ok) {
    const rawError = payload?.error
    const message = typeof rawError === 'string'
      ? rawError
      : rawError?.message || `Request failed with status ${response.status}`
    const normalizedPayload = typeof rawError === 'string'
      ? { error: { message: rawError } }
      : payload || undefined
    throw new ApiError(message, response.status, normalizedPayload)
  }

  return payload as T
}
