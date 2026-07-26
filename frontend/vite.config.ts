import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const host = env.VITE_DEV_HOST || "0.0.0.0";
  const port = parsePort(env.FRONTEND_PORT, 3000);

  return {
    plugins: [react()],
    envDir: "..",
    server: {
      port,
      host
    },
    preview: {
      host: env.VITE_PREVIEW_HOST || host,
      port: parsePort(env.VITE_PREVIEW_PORT || env.FRONTEND_PORT, 3000),
      allowedHosts: [
        "www.auditcopilot.ai",
        "auditcopilot.ai",
        "www.assurancegraph.com",
        "assurancegraph.com",
        ".up.railway.app"
      ]
    }
  };
});
