import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type PluginOption } from 'vite';

export default defineConfig(async () => {
  let pwaPlugin: PluginOption | null = null;
  try {
    const pwaModule = await import('vite-plugin-pwa');
    if (pwaModule && pwaModule.VitePWA) {
      pwaPlugin = pwaModule.VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'نظام ادارة الصيدلية - إتقان سوفت',
          short_name: 'الصيدلية',
          description: 'نظام متكامل لإدارة الصيدلية، المخزون، ونقاط البيع مع دعم الباركود والتشغيل كـ PWA.',
          theme_color: '#0284c7',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/assets/aistudio/7c2a7a8e-5e01-4eeb-80ee-00aa057372e0_d6bfeb4f.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/aistudio/7c2a7a8e-5e01-4eeb-80ee-00aa057372e0_d6bfeb4f.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      });
    }
  } catch {
    // If vite-plugin-pwa is not available or when building electron, build continues cleanly
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(pwaPlugin ? [pwaPlugin] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});


