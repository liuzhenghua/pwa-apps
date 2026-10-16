import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const base = `/${process.env.PWA_REPO || 'pwa-apps'}/assets/`;
export default defineConfig({base,plugins:[react(),VitePWA({registerType:'autoUpdate',manifest:{name:'资产簿',short_name:'资产簿',description:'个人净资产追踪',lang:'zh-CN',start_url:base,scope:base,display:'standalone',theme_color:'#143e39',background_color:'#f5f7f4',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png'}]},includeAssets:['icon.svg','icon-192.png','icon-512.png']})],build:{outDir:'../../dist/assets',emptyOutDir:false}});
