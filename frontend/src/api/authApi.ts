import { apiRequest } from "./client";
import type { RuntimeSettings } from "./settingsApi";

export type UserMe = {
  isAuthenticated: boolean;
  email: string | null;
  canRunAgents: boolean;
  runtime: RuntimeSettings;
};

export const authApi = {
  me: () => apiRequest<UserMe>("/api/auth/me"),
  login: (email: string, password: string) =>
    apiRequest<UserMe>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (email: string, password: string) =>
    apiRequest<UserMe>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => apiRequest<UserMe>("/api/auth/logout", { method: "POST" })
};
