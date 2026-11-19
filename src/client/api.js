// Llamadas HTTP al servidor. Los errores llegan como Error con el mensaje del servidor.

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.')
  }
  if (raw && response.ok) return response
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/admin') && path !== '/admin/login') {
      window.dispatchEvent(new Event('radio:session-expired'))
    }
    throw new ApiError(response.status, data?.error ?? `Error ${response.status}`, data)
  }
  return data
}
