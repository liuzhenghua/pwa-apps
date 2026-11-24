import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/stocks/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { importScripts: ['stock-push.js'] },
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        id: base,
        name: '股票账簿',
        short_name: '股票账簿',
        description: '自动查看沪深行情，记录最近三笔买价和卖价',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#10254b',
        background_color: '#f2f5fa',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  build: { outDir: '../../dist/stocks', emptyOutDir: false },
});
