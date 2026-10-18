export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response, result
  // A reply that is not JSON, such as a proxy's error page, means the app itself was not reached.
  try { response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Competition-Client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) }); result = await response.json() }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.') }
  if (!response.ok) throw new ApiError(response.status, result.error || 'Request failed.')
  return result as T
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'
