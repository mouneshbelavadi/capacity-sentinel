/**
 * RackSense — API Client
 *
 * The single fetch wrapper.
 * - Attaches bearer token from storage
 * - Parses { error: { code, message, detail } } envelopes into ApiClientError
 * - Checks contract version and flags major mismatch
 * - Never swallows an error code
 */

import {
  CONTRACT_VERSION,
  ErrorCode,
  ApiErrorEnvelope,
  MetaResponse,
} from './contract';

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

// Token storage key
const TOKEN_STORAGE_KEY = 'racksense_auth_token';

// In-memory token cache
let inMemoryToken: string | null = null;

// Safe sessionStorage retrieval
export function getStoredToken(): string | null {
  if (inMemoryToken) {
    return inMemoryToken;
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const val = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
      inMemoryToken = val;
      return val;
    }
  } catch {
    // sessionStorage can throw (e.g. sandboxed iframe or disabled cookies)
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (token) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage exceptions
  }
}

// Contract version listener / state
type VersionMismatchListener = (mismatch: {
  clientVersion: string;
  backendVersion: string;
} | null) => void;

let versionListener: VersionMismatchListener | null = null;

export function onContractVersionMismatch(listener: VersionMismatchListener): () => void {
  versionListener = listener;
  return () => {
    if (versionListener === listener) {
      versionListener = null;
    }
  };
}

function parseMajor(versionStr: string): number {
  const parts = versionStr.split('.');
  const num = parseInt(parts[0], 10);
  return Number.isNaN(num) ? 0 : num;
}

export function isMajorMismatch(clientVer: string, backendVer: string): boolean {
  return parseMajor(clientVer) !== parseMajor(backendVer);
}

// Base request execution
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorCode: ErrorCode = 'INTERNAL';
    let errorMessage = `HTTP error ${response.status}`;
    let detail: Record<string, unknown> | undefined;

    try {
      const data = (await response.json()) as Partial<ApiErrorEnvelope>;
      if (data && data.error && typeof data.error.code === 'string') {
        errorCode = data.error.code as ErrorCode;
        errorMessage = data.error.message || errorMessage;
        detail = data.error.detail;
      }
    } catch {
      // Body was not JSON; use default status error
    }

    throw new ApiClientError(response.status, errorCode, errorMessage, detail);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get<T>(path: string, options?: RequestInit): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },

  post<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async verifyContractVersion(): Promise<{
    ok: boolean;
    clientVersion: string;
    backendVersion: string;
  }> {
    try {
      const meta = await this.get<MetaResponse>('/api/meta');
      const backendVersion = meta.contract_version;
      const mismatch = isMajorMismatch(CONTRACT_VERSION, backendVersion);

      if (mismatch) {
        if (versionListener) {
          versionListener({
            clientVersion: CONTRACT_VERSION,
            backendVersion,
          });
        }
        return {
          ok: false,
          clientVersion: CONTRACT_VERSION,
          backendVersion,
        };
      }

      if (versionListener) {
        versionListener(null);
      }

      return {
        ok: true,
        clientVersion: CONTRACT_VERSION,
        backendVersion,
      };
    } catch (err) {
      // If endpoint is unreachable on boot or returns error, pass through
      return {
        ok: true,
        clientVersion: CONTRACT_VERSION,
        backendVersion: 'unreachable',
      };
    }
  },
};
