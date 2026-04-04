const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

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
  const response = await fetch(buildApiUrl(path, query), init)
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : null

  if (!response.ok) {
    const message = payload?.error?.message || `Request failed with status ${response.status}`
    throw new ApiError(message, response.status, payload || undefined)
  }

  return payload as T
}
