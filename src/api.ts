export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Competition-Client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) }) }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.') }
  const result = await response.json()
  if (!response.ok) throw new ApiError(response.status, result.error || 'Request failed.')
  return result as T
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'
