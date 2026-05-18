import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0"
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    allowedHosts: [
      "www.auditcopilot.ai",
      "auditcopilot.ai",
      ".up.railway.app"
    ]
  }
});