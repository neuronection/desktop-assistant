import { defineConfig, type Plugin } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Dev-only CSP variant (family pattern from guidelines/security.md): Vite
// needs an inline refresh preamble + HMR, which the committed strict CSP
// (script-src 'self') blocks — the React entries would render blank in dev.
// Production builds keep the strict policy untouched.
export const devCspRelax = (): Plugin => ({
  name: 'dev-csp-relax',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (!ctx.server) {
        return html;
      }
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
        .replace("default-src 'self';", "default-src 'self' ws://localhost:5173;");
    },
  },
});

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        settings: resolve(__dirname, 'src/renderer/settings.html'),
        'result-viewer': resolve(__dirname, 'src/renderer/result-viewer.html')
      }
    },
    assetsDir: 'assets'
  },
  optimizeDeps: {
    // NOTE: the family default (optimizeDeps.exclude: assistant-ui) exists
    // for linked library development. This app installs from the registry,
    // and the excluded ESM package's CJS transitive deps (style-to-js,
    // debug, …) get served raw in dev and crash the app with "does not
    // provide an export". Pre-bundling everything converts them. Re-add
    // the exclude ONLY together with include entries for every CJS
    // transitive dep when doing linked library development.
  },
  server: {
    port: 5173,
  },
  css: {
    devSourcemap: true
  },
  define: {

    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    '__IS_DEV__': JSON.stringify(process.env.NODE_ENV === 'development'),
  },

  resolve: {
    dedupe: ['react', 'react-dom'], 
    alias: {
      katex: resolve(__dirname, 'node_modules/katex/dist/katex.mjs')
    }
  },
  plugins: [react(), tailwindcss(), tsconfigPaths(), devCspRelax()]
});