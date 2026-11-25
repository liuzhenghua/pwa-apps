# pwa-apps

一个仓库管理多个面向手机的 React + Vite PWA。各应用独立开发，构建后汇总到 `dist/`，由一次 GitHub Pages 工作流发布。

| 应用 | 功能 |
| --- | --- |
| [笔记](apps/notes/README.md) | 本地笔记、搜索、加密 GitHub 同步 |
| [照片布局](apps/photo-layout/README.md) | 6 寸照片排版与导出 |
| [股票账簿](apps/stocks/README.md) | 沪深行情、做 T 周期、价格提醒与加密同步 |
| [资产簿](apps/assets/README.md) | 月度余额、净资产趋势、盘点与加密备份 |

默认入口：<https://liuzhenghua.github.io/pwa-apps/>。PWA 的安装和离线行为见 [PWA 说明](docs/pwa.md)。

## 本地启动

需要 Node.js 22 和 npm。在仓库根目录安装依赖。

```sh
npm ci

# 只运行所需应用对应的一条命令
npm run dev:notes
npm run dev:photo-layout
npm run dev:assets
npm run dev:stocks
```

在另一个终端运行检查、测试和构建。

```sh
npm run typecheck
npm run test:stocks
npm run build
```

构建脚本将首页及各应用输出到 `dist/`。每个应用都有自己的 PWA manifest 和 Service Worker。

## 部署与通用配置

推送到 `main` 后，[GitHub Actions 工作流](.github/workflows/deploy.yml)会构建并发布整个 `dist/`。首次部署时，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

- 默认站点路径为 `/pwa-apps/`。仓库改名时，同步修改工作流里的 `PWA_REPO` 和 [构建脚本](scripts/build.mjs)中的默认值。
- 笔记、资产簿与股票账簿的云端数据使用私有仓库 `liuzhenghua/pwa-apps-data`，各自存放在不同目录。各应用的同步方式见[笔记说明](apps/notes/README.md#同步规则)、[资产簿说明](apps/assets/README.md#配置-github-访问)和[股票账簿说明](apps/stocks/README.md#github-加密同步)。
- 本地 Vite 配置放在对应应用目录的 `.env.local`；此类文件已被 Git 忽略。

## 云端数据与加密 Token 配置

笔记、资产簿和股票账簿可以把加密数据同步到私有仓库 `liuzhenghua/pwa-apps-data`，需要一个仅对该仓库有 **Contents: Read and write** 权限的 [Fine-grained Token](https://github.com/settings/personal-access-tokens/new)。三个应用共用一份**加密后的 Token**，但各自的数据目录和数据加密口令独立。

先创建该私有仓库并生成 Token。为解锁 Token 单独设置一条强随机口令，首次生成配置时在仓库根目录执行。

```sh
cat > .env.token.local <<'ENV'
DATA_GITHUB_TOKEN=你的GitHub_Token
DATA_TOKEN_PASSPHRASE=你的独立长口令
ENV
node --env-file=.env.token.local scripts/encrypt-github-token.mjs
rm .env.token.local
```

脚本会把同一份 `VITE_GITHUB_TOKEN_BOX` 密文写入 `apps/notes/.env.local`、`apps/assets/.env.local` 和 `apps/stocks/.env.local`，供本地 Vite 使用。把其中等号后的值配置为本仓库的 GitHub Actions Secret **`DATA_GITHUB_TOKEN_BOX`**；[部署工作流](.github/workflows/deploy.yml)会在构建应用时注入密文。修改本地 `.env.local` 后重启开发服务器。所有 `.local` 文件均被 Git 忽略。

构建产物中的密文对访问者可见；云端访问口令越容易猜，Token 被解出的风险越高。各应用的解锁口令保存在对应的浏览器本地配置中，可在同步配置中清除。忘记口令或更换 Token 时，重新生成密文、更新 CI Secret 并重新部署。未配置密文时，笔记和资产簿支持手动输入 Token。股票账簿的同步和提醒需要配置密文。

注意：Token 的写权限覆盖所选仓库，而不只覆盖某个应用目录。加密数据内容仍由各应用自己的口令保护，但拿到 Token 的人能删除或覆盖密文文件。

## 项目目录

```text
apps/                 # 各应用源码与独立 README
packages/shared/      # 共用代码
scripts/build.mjs      # 汇总生产构建
site/                  # 站点首页
.github/workflows/     # Pages 部署工作流
docs/                  # 跨应用说明
dist/                  # 构建产物，不提交到 Git
```

加密算法与数据边界分别见[笔记的云端加密原理](apps/notes/README.md#云端加密原理)、[资产簿的加密方案](apps/assets/README.md#加密方案)和[股票账簿的同步说明](apps/stocks/README.md#github-加密同步)。
