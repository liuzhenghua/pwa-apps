import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const app of ['notes', 'photo-layout']) {
  execFileSync('npm', ['run', 'build', '-w', `@pwa-apps/${app}`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PWA_REPO: process.env.PWA_REPO || 'pwa-apps' },
  });
}

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/`;
writeFileSync(resolve(dist, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>我的应用</title><style>body{font-family:system-ui,sans-serif;max-width:680px;margin:12vh auto;padding:0 24px;color:#17202a}a{display:block;padding:20px;margin:12px 0;border:1px solid #ddd;border-radius:12px;color:inherit;text-decoration:none}a:hover{background:#f5f7fa}</style></head><body><h1>我的应用</h1><a href="${base}notes/">笔记</a><a href="${base}photo-layout/">照片布局</a></body></html>`);
writeFileSync(resolve(dist, '.nojekyll'), '');
