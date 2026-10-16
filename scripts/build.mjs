import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const app of ['notes', 'photo-layout', 'assets']) {
  execFileSync('npm', ['run', 'build', '-w', `@pwa-apps/${app}`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PWA_REPO: process.env.PWA_REPO || 'pwa-apps' },
  });
}

const base = `/${process.env.PWA_REPO || 'pwa-apps'}/`;
const home = readFileSync(resolve(root, 'site/index.html'), 'utf8');
writeFileSync(resolve(dist, 'index.html'), home.replaceAll('__BASE__', base));
writeFileSync(resolve(dist, '.nojekyll'), '');
