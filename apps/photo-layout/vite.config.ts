import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/photo-layout/`;
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: '照片布局', short_name: '照片布局', description: '本地照片排版', lang: 'zh-CN', start_url: base, scope: base, display: 'standalone', theme_color: '#3b4d42', background_color: '#ffffff', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] },
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
  })],
  build: { outDir: '../../dist/photo-layout', emptyOutDir: false },
});
