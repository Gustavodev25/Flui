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

export async function apiFetch<T>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  const finalInit = { ...init }
  const headers = new Headers(finalInit.headers || {})
  const { data: { session } } = await supabase.auth.getSession()
  
  // Se for ngrok, adiciona o header para pular a tela de aviso
  if (API_BASE_URL.includes('ngrok-free.dev')) {
    headers.set('ngrok-skip-browser-warning', 'true')
  }

  if (session?.access_token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  
  finalInit.headers = headers

  const response = await fetch(buildApiUrl(path, query), finalInit)
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
