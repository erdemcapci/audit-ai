const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
export const API_BASE_URL = configuredApiBaseUrl ? configuredApiBaseUrl.replace(/\/$/, "") : "";

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = response.statusText;
    const rawBody = await response.text();
    if (rawBody) {
      try {
        const body = JSON.parse(rawBody);
        message = body.detail || rawBody;
      } catch {
        message = rawBody;
      }
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text() as Promise<T>;
}
