export interface WsRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

export interface WsResponse {
  id: number
  result: unknown
}

export interface WsErrorResponse {
  id: number
  error: { message: string }
}

export type WsMessage = WsRequest | WsResponse | WsErrorResponse

let nextId = 0

export function resetIdCounter(): void {
  nextId = 0
}

export function createRequest(method: string, params: Record<string, unknown>): WsRequest {
  return { id: ++nextId, method, params }
}

export function createResponse(id: number, result: unknown): WsResponse {
  return { id, result }
}

export function createErrorResponse(id: number, message: string): WsErrorResponse {
  return { id, error: { message } }
}

export function isResponse(msg: WsMessage): msg is WsResponse {
  return 'result' in msg
}

export function isErrorResponse(msg: WsMessage): msg is WsErrorResponse {
  return 'error' in msg
}
