const TOKEN_KEY = 'claw-dashboard-token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string> || {}),
    'Authorization': `Bearer ${token}`,
  };
  const res = await fetch(path, { ...opts, headers });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;

    try {
      const body = await res.json();
      if (body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string') {
        message = (body as any).error;
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the default message.
    }

    if (res.status === 401 || res.status === 403) {
      clearToken();
    }

    throw new Error(message);
  }

  return res.json() as Promise<T>;
}
