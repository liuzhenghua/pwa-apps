import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/notes/`;
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: '笔记簿', short_name: '笔记簿', description: '离线优先的个人笔记簿', lang: 'zh-CN', start_url: base, scope: base, display: 'standalone', theme_color: '#263d54', background_color: '#ffffff', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] },
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
  })],
  build: { outDir: '../../dist/notes', emptyOutDir: false },
});
