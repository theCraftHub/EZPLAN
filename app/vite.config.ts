import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { BRAND, FILE_EXTENSIONS } from "../shared/src/brand.ts";

/** The product name comes from brand.ts only: page title and the install manifest. */
function brand(): Plugin {
  const manifest = JSON.stringify(
    {
      name: BRAND.name,
      short_name: BRAND.name,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: BRAND.colors.ground,
      theme_color: BRAND.colors.ink,
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      file_handlers: [{ action: "/new", accept: { "text/markdown": [...FILE_EXTENSIONS, ".md"] } }],
    },
    null,
    2,
  );
  return {
    name: "brand",
    transformIndexHtml: (html) => html.replaceAll("%BRAND_NAME%", BRAND.name),
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("content-type", "application/manifest+json");
        res.end(manifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
    },
  };
}

// In development the site runs on Vite and the API on the self-hosted server (npm start in selfhost/).
const api = process.env.API_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwind(), brand()],
  server: { proxy: { "/api": { target: api, ws: true }, "/auth": api } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
