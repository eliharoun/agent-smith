const TOKEN_KEY = "smith.gui.token";

export function captureToken(): void {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    params.delete("token");
    const search = params.toString();
    history.replaceState({}, "", window.location.pathname + (search ? `?${search}` : ""));
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText, code: "UNKNOWN" }))) as {
      error: string;
      code: string;
    };
    throw new ApiError(res.status, body.code, body.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
