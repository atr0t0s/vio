interface RequestConfig {
  method: string
  headers: Record<string, string>
  body?: string
}

interface HttpResponse<T = unknown> {
  data: T
  status: number
  headers: Headers
}

type RequestInterceptor = (config: RequestConfig) => RequestConfig
type ResponseInterceptor = (response: HttpResponse) => HttpResponse

interface HttpClientOptions {
  baseURL?: string
  headers?: Record<string, string>
}

export class HttpClient {
  private baseURL: string
  private defaultHeaders: Record<string, string>
  interceptors = {
    request: {
      handlers: [] as RequestInterceptor[],
      use(fn: RequestInterceptor) { this.handlers.push(fn) }
    },
    response: {
      handlers: [] as ResponseInterceptor[],
      use(fn: ResponseInterceptor) { this.handlers.push(fn) }
    }
  }

  constructor(options: HttpClientOptions = {}) {
    this.baseURL = options.baseURL ?? ''
    this.defaultHeaders = options.headers ?? {}
  }

  async get<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, headers)
  }

  async post<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, headers)
  }

  async put<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, body, headers)
  }

  async delete<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, headers)
  }

  private async request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    let config: RequestConfig = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...headers
      }
    }

    if (body !== undefined) {
      config.body = JSON.stringify(body)
    }

    for (const interceptor of this.interceptors.request.handlers) {
      config = interceptor(config)
    }

    const fullURL = this.baseURL + url
    const res = await fetch(fullURL, config)

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    const data = contentType.includes('application/json') ? await res.json() : await res.text()

    let response: HttpResponse<T> = { data: data as T, status: res.status, headers: res.headers }

    for (const interceptor of this.interceptors.response.handlers) {
      response = interceptor(response) as HttpResponse<T>
    }

    return response
  }
}
