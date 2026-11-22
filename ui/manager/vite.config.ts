import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error The payload builder is a plain JavaScript module.
import { buildCodexPayload } from "../../bin/lib/codex.js";
const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "../..");
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "rasta-local-assets",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url || "/", "http://localhost");
          const messageDirectionPreview = url.pathname === "/" && url.searchParams.get("preview") === "message-directions";
          if (url.pathname === "/panel-preview" || messageDirectionPreview) {
            try {
              const fixture = messageDirectionPreview ? "message-directions.html" : "panel.html";
              let html = fs.readFileSync(path.join(workspace, "tools/manager-preview", fixture), "utf8");
              const host = url.searchParams.get("host");
              if (messageDirectionPreview && (host === "t3" || host === "antigravity" || host === "zcode")) {
                html = html.replace("/panel-preview/payload.js?host=codex", "/panel-preview/payload.js?host=" + host);
              }
              const preview = await server.transformIndexHtml(url.pathname, html);
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(preview);
            } catch (error) {
              next(error);
            }
            return;
          }
          if (url.pathname === "/panel-preview/payload.js") {
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
            const host = url.searchParams.get("host");
            const target = host === "t3" || host === "antigravity" || host === "opencode" || host === "zcode" ? host : "codex";
            res.end(buildCodexPayload(undefined, { target, panelSource: "" }));
            return;
          }
          if (url.pathname === "/manager/index.html") {
            res.writeHead(302, { Location: "/" });
            res.end();
            return;
          }
          if (
            !url.pathname.startsWith("/manager/icons/") &&
            !url.pathname.startsWith("/assets/")
          )
            return next();
          const file = path.resolve(workspace, "bin", "." + url.pathname);
          if (
            !file.startsWith(path.join(workspace, "bin") + path.sep) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
          ) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.setHeader(
            "Content-Type",
            file.endsWith(".png") ? "image/png" : "font/woff2",
          );
          fs.createReadStream(file).pipe(res);
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(directory, "src"),
      "@rasta-preview-bridge": path.join(workspace, "tools/manager-preview/bridge.js"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [workspace] },
  },
  base: "./",
  ...(mode === "panel" && { define: { "process.env.NODE_ENV": JSON.stringify("production") } }),
  build: {
    ...(mode === "panel" && {
      minify: true,
      rolldownOptions: { output: { minify: { codegen: { asciiOnly: true } } } },
      lib: { entry: path.resolve(directory, "src/ConnectionPanel.tsx"), name: "RastaConnectionPanel", formats: ["iife"], fileName: () => "panel.js" },
    }),
    outDir: mode === "panel" ? "../../bin/panel" : "../../dist/manager-ui",
    emptyOutDir: true,
    ...(mode === "native" && {
      modulePreload: false,
      rolldownOptions: { output: { format: "iife" } },
    }),
  },
}));
