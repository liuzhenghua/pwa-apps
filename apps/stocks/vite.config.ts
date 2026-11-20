import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/stocks/`;

export default defineConfig(({ mode, command }) => {
  const tokenKey = 'VITE_GITHUB_TOKEN_BOX';
  const ownEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), tokenKey);
  const sharedLocalBox = command === 'serve' && !ownEnv[tokenKey]
    ? loadEnv(mode, fileURLToPath(new URL('../assets/', import.meta.url)), tokenKey)[tokenKey]
    : undefined;

  return {
    define: sharedLocalBox ? { 'import.meta.env.VITE_GITHUB_TOKEN_BOX': JSON.stringify(sharedLocalBox) } : {},
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          id: base,
          name: '股票账簿',
          short_name: '股票账簿',
          description: '管理股票持仓与买入批次，计算卖出收益',
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
  };
});
