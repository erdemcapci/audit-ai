const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const API_BASE_URL = configuredApiBaseUrl ? configuredApiBaseUrl.replace(/\/$/, "") : "";

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) throw new Error(await errorMessage(response));

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text() as Promise<T>;
}

/** Binary download (e.g. a stored source file). */
export async function apiRequestBinary(path: string, options: RequestInit = {}): Promise<ArrayBuffer> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...options });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.arrayBuffer();
}

async function errorMessage(response: Response): Promise<string> {
  const rawBody = await response.text();
  try {
    const body = JSON.parse(rawBody);
    return body.detail || response.statusText;
  } catch {
    return rawBody || response.statusText;
  }
}
