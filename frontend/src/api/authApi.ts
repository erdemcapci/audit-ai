import { apiRequest } from "./client";
import type { RuntimeSettings } from "./settingsApi";

export type UserMe = {
  isAuthenticated: boolean;
  username: string | null;
  accessCode?: string | null;
  canRunAgents: boolean;
  runtime: RuntimeSettings;
};

export const authApi = {
  me: () => apiRequest<UserMe>("/api/auth/me"),
  login: (username: string, accessCode: string) =>
    apiRequest<UserMe>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, access_code: accessCode }) }),
  signup: (username: string) =>
    apiRequest<UserMe>("/api/auth/signup", { method: "POST", body: JSON.stringify({ username }) }),
  logout: () => apiRequest<UserMe>("/api/auth/logout", { method: "POST" })
};
