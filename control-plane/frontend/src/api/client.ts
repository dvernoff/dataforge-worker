import { useAuthStore } from '@/stores/auth.store';

const BASE_URL = '/api';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export class ApiError extends Error {
  errorCode?: string;
  column?: string;
  targetType?: string;
  detail?: string;
  constraint?: string;
  table?: string;

  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    if (metadata) {
      for (const key of ['errorCode', 'column', 'targetType', 'detail', 'constraint', 'table'] as const) {
        if (metadata[key] != null) {
          (this as Record<string, unknown>)[key] = metadata[key];
        }
      }
    }
  }
}

class ApiClient {
  private refreshPromise: Promise<string | null> | null = null;

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers: customHeaders, ...rest } = options;
    const token = useAuthStore.getState().accessToken;

    const headers: Record<string, string> = {
      ...customHeaders as Record<string, string>,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...rest,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });

    if (response.status === 401 && token) {
      const newToken = await this.refreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${BASE_URL}${endpoint}`, {
          ...rest,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          throw await this.createError(retryResponse);
        }
        const retryText = await retryResponse.text();
        if (!retryText) return undefined as T;
        return JSON.parse(retryText) as T;
      }

      // Refresh failed, logout
      useAuthStore.getState().logout();
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    if (!response.ok) {
      throw await this.createError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON response from ${endpoint}`);
    }
  }

  private async refreshToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json() as { accessToken: string; user: unknown };
        useAuthStore.getState().setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async createError(response: Response): Promise<ApiError> {
    try {
      const data = await response.json() as Record<string, unknown>;
      return new ApiError(
        (data.error as string) ?? `Request failed with status ${response.status}`,
        data
      );
    } catch {
      return new ApiError(`Request failed with status ${response.status}`);
    }
  }

  get<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  put<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, { method: 'PUT', body });
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
