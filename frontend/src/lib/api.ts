import type { TokenResponse } from "./types";

export const API_ROOT = "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<TokenResponse | null> | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  raw?: boolean;
};

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let code = "http_error";
  let details: unknown;
  try {
    const data = await response.json();
    if (data?.error) {
      message = data.error.message ?? message;
      code = data.error.code ?? code;
      details = data.error.details;
    } else if (typeof data?.detail === "string") {
      message = data.detail;
    } else if (Array.isArray(data?.detail)) {
      message = data.detail
        .map((item: { msg?: string; loc?: unknown[] }) => item.msg ?? "Invalid value")
        .join("; ");
      details = data.detail;
      code = "validation_error";
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(response.status, message, code, details);
}

export async function refreshSession(): Promise<TokenResponse | null> {
  if (refreshPromise) return refreshPromise;
  const run = (async () => {
    try {
      const response = await fetch(`${API_ROOT}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        accessToken = null;
        return null;
      }
      const data = (await response.json()) as TokenResponse;
      accessToken = data.access_token;
      return data;
    } catch {
      accessToken = null;
      return null;
    }
  })();
  refreshPromise = run;
  try {
    return await run;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (accessToken && !options.skipAuth) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "Cannot reach the ScrapSetu API. Is the backend running?", "network_error");
  }

  if (response.status === 401 && !options.skipRefresh && !options.skipAuth) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (options.raw || !contentType.includes("application/json")) {
    return (await response.blob()) as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "GET" });
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "POST", body });
  },
  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "PATCH", body });
  },
  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "PUT", body });
  },
  delete<T>(path: string, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "DELETE" });
  },
  upload<T>(path: string, formData: FormData, options?: RequestOptions) {
    return request<T>(path, { ...options, method: "POST", formData });
  },
  async download(path: string, filename: string) {
    const blob = await request<Blob>(path, { raw: true });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  },
};

export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("blob:")) return path;
  return path.startsWith("/api/") ? path : `/api/v1/files/${path}`;
}
