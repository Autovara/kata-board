import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PORT || "8787";
  const apiTarget = env.VITE_API_TARGET || `http://localhost:${apiPort}`;
  const repositoryName = env.GITHUB_REPOSITORY?.split("/").at(-1);
  const base = env.VITE_BASE_PATH || (repositoryName ? `/${repositoryName}/` : "/");

  return {
    base,
    plugins: [react()],
    server: {
      port: 4173,
      proxy: {
        "/api": apiTarget
      }
    }
  };
});
