// Build: forced refresh 2026-05-27
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rawTarget = env.VITE_AI_AGENT_URL || "http://localhost:8000";
  const target = rawTarget.trim().replace(/\/+$/, "") || "http://localhost:8000";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/__ai": {
          target,
          changeOrigin: true,
          rewrite: (pathValue) => pathValue.replace(/^\/__ai/, ""),
        },
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "pwa-192.png", "pwa-512.png"],
        manifest: {
          name: "dailyFlow",
          short_name: "dailyFlow",
          description: "Organize tasks, finances, calendar and family in one place.",
          theme_color: "#0F172A",
          background_color: "#0F172A",
          display: "standalone",
          scope: "/",
          start_url: "/",
          icons: [
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
          shortcuts: [
            { name: "Tasks", short_name: "Tasks", url: "/tasks", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
            { name: "Calendar", short_name: "Calendar", url: "/calendar", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
            { name: "Learn AI", short_name: "Learn AI", url: "/learn-ai", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
          ],
        },
        workbox: {
          // Cloudflare _redirects handles SPA navigation (/* /index.html 200).
          // Setting navigateFallback to null prevents Workbox from trying to
          // serve index.html from precache (which it no longer holds), which
          // was causing "non-precached-url" crashes on every page navigation.
          navigateFallback: null,
          // Never precache HTML — index.html changes every build (new JS hashes).
          globPatterns: ["**/*.{css,ico,png,svg,woff2}"],
          runtimeCaching: [
            {
              // Auth/API calls must NEVER be cached — always go to network.
              // Caching status 0 (network error) was replaying failures as responses.
              urlPattern: ({ url }) => url.hostname.includes("supabase.co"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ url }) => url.hostname === "api.barakzai.cloud",
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        'scripts/**',
        // MB-02b: Playwright specs (real-browser only, run via `npx
        // playwright test`) -- these import '@playwright/test', whose
        // test()/describe() collide with vitest's own globals if vitest
        // tries to collect them too.
        'e2e/**',
      ],
    },
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
            'vendor-query':    ['@tanstack/react-query', 'zustand'],
            'vendor-motion':   ['framer-motion'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-recharts': ['recharts'],
            'vendor-pdfjs':    ['pdfjs-dist'],
            'vendor-pdf-lib':  ['pdf-lib'],
            'vendor-canvas':   ['html2canvas', 'jszip'],
            'vendor-tiptap': [
              '@tiptap/react',
              '@tiptap/starter-kit',
              '@tiptap/extension-underline',
              '@tiptap/extension-text-align',
              '@tiptap/extension-color',
              '@tiptap/extension-text-style',
              '@tiptap/extension-font-family',
              '@tiptap/extension-highlight',
              '@tiptap/extension-link',
              '@tiptap/extension-placeholder',
              '@tiptap/extension-table',
              '@tiptap/extension-table-row',
              '@tiptap/extension-table-header',
              '@tiptap/extension-table-cell',
              '@tiptap/extension-image',
              '@tiptap/extension-typography',
            ],
            'vendor-docx': ['docx'],
          },
        },
      },
    },
  };
});
