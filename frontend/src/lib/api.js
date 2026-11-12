const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.message || 'Something went wrong. Please try again.')
    error.status = response.status
    error.details = body.errors || []
    throw error
  }
  return body
}
