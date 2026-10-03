import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// base: './' 让同一份构建产物可以部署在根路径或任意子路径（CF Pages / Vercel / GitHub Pages / Caddy）
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // 有新版本时由页面提示用户刷新，而不是悄悄替换
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'TimeEncre',
        short_name: 'TimeEncre',
        description: '时间记录：计时、历史、统计、目标、番茄钟',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#2445c9',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 只预缓存拉丁字符的字体子集，其余子集按需加载
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}', '**/*-latin-wght-normal-*.woff2'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
