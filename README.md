# pwa-apps

一个仓库管理多个面向手机端的 React + Vite PWA。每个应用独立开发、独立生成 PWA manifest 和 Service Worker，构建时汇总到同一个 `dist/`，由一次 GitHub Pages 部署发布。

第一次接触 PWA？参见 [PWA 是什么，以及本项目如何使用它](docs/pwa.md)。

目前包含：

| 应用 | 地址 | 功能 |
| --- | --- | --- |
| 笔记 | `/pwa-apps/notes/` | 搜索、编辑、左滑删除、本地保存、加密云端同步 |
| 照片布局 | `/pwa-apps/photo-layout/` | 首页选 6 寸模板，进入后按位置添加照片、导出 JPG 或系统分享；刷新后清空 |

照片布局参考了 [原项目的 6 寸排版](https://github.com/liuzhenghua/photo-layout)。七种模板均可选择导出画质；常规拼图和拍立得可调边距，拍立得可为每张照片单独编辑底部文字。横版和竖版画中画保留了倾斜相框、添加和移除相框、拖动位置、调整大小与角度及照片裁剪。

## 项目结构

```text
pwa-apps/
├── apps/
│   ├── notes/             # 笔记应用
│   └── photo-layout/      # 照片布局应用
├── packages/shared/       # 共用代码
├── scripts/build.mjs      # 汇总两个应用的构建结果
├── .github/workflows/     # Pages 部署工作流
└── dist/                  # 构建产物，不提交到 Git
```

## 本地开发与发布

需要 Node.js 22 和 npm。首次安装依赖后，可分别启动应用：

```sh
npm ci
npm run dev:notes
npm run dev:photo-layout
```

检查和构建：

```sh
npm run typecheck
npm run build
```

`dist/index.html` 是应用入口；`dist/notes/`、`dist/photo-layout/` 各有独立的 `index.html`、`manifest.webmanifest` 和 `sw.js`。推送到 `main` 后，GitHub Actions 会一次发布整个 `dist/`。首次使用时，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

默认站点地址是 `https://liuzhenghua.github.io/pwa-apps/`。如果 GitHub 仓库改名，需要同步修改工作流的 `PWA_REPO` 和构建脚本中的默认仓库名。

## 笔记数据与同步

笔记首先保存在当前浏览器的 `localStorage`。点击笔记页右上角的云端同步按钮，再点“开始同步”，应用才会访问 GitHub；编辑时不会自动上传。

云端数据仓库固定为 **`liuzhenghua/pwa-apps-data`**，需要先在 GitHub 创建为 **Private**。它可容纳以后其他应用的数据；笔记使用自己的顶层目录：

```text
pwa-apps-data/
└── notes/
    └── <名字>/
        ├── _crypto.json
        ├── <笔记ID-1>.json
        └── <笔记ID-2>.json
```

“名字”决定文件夹，支持字母、数字、下划线和连字符。每条笔记单独存一个加密文件，文件名是随机笔记 ID，不包含标题。

### 配置 GitHub 访问

1. 创建私有仓库 `liuzhenghua/pwa-apps-data`。
2. [创建 Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，只选择这个仓库，授予 **Contents: Read and write**。同步弹窗中 Token 旁的问号也提供入口。
3. 在同步弹窗填写名字、Token 和加密口令，点击“开始同步”。

首次成功读取仓库后，三个值保存在当前设备的 `localStorage`，以后自动填入。弹窗中的“清除已保存的配置”会删除它们。加密口令要足够长且独立；丢失后无法解密云端笔记。

### 同步方向与性能

应用保存上次成功同步时的本地笔记快照与云端文件 SHA 列表。每次同步先读 GitHub 目录：

- 两边都没有变化：直接结束，不下载或解密每条笔记。
- 仅一边有变化：自动向另一边同步。
- 两边都有变化：按笔记 ID 合并；同一笔记选择 `updated` 时间较新的版本。删除依据上次同步快照判断。
- 同一时间出现不同内容，或一边编辑而另一边删除：显示差异，让用户选择保留本地或云端，并在覆盖前确认。

更新时间取自设备时钟，因此各设备时间需要准确。发生变化时，目前仍需读取云端笔记文件；GitHub Contents 目录接口接近 1000 个文件时，应用会停止同步并提示升级方案。每条云端写入通过 GitHub Contents API 单独提交，批量同步不是原子操作；中途失败可能只完成部分写入，重新同步会再次比较状态。

## 云端加密如何工作

加密与解密在浏览器内通过 Web Crypto 完成。应用不会把明文笔记或加密口令发送到 GitHub；GitHub 收到的是加密配置和笔记密文。

1. 每个“名字”首次上传时生成 **16 字节随机 salt**。口令与 salt 经 **PBKDF2-HMAC-SHA-256（600,000 次迭代）** 派生出 **256 位 AES 密钥**。同一文件夹的笔记共用这个密钥；每次读取一批笔记时只需派生一次，而不是每条笔记各派生一次。
2. `_crypto.json` 保存版本、KDF 参数、salt，以及用该密钥加密的固定校验文本。`checkIv` 是这段校验密文的 IV，用于在下载笔记前检查口令是否正确。它不包含口令或 AES 密钥。
3. 每次写入一条笔记，都生成新的 **12 字节随机 IV**，用 **AES-256-GCM** 加密包含 ID、标题、正文和更新时间的 JSON。该笔记文件只保存 `version`、`iv` 和 `ciphertext`；GCM 认证标签包含在密文中。
4. 解密时先读取 `_crypto.json` 的 salt，用输入的口令重新派生密钥并验证校验密文；再用每条笔记文件自己的 IV 解密。salt 和 IV 不需要保密，但必须和密文一起保留。

云端仍可看见文件夹名字、随机笔记 ID、文件数量、文件大小和 Git 提交时间。当前浏览器中的笔记明文、Token 与加密口令保存在本地 `localStorage`；云端加密保护的是 GitHub 仓库里的笔记内容。

实现代码见 `apps/notes/src/crypto.ts`（加密）、`apps/notes/src/sync.ts`（GitHub 读写与合并）和 `apps/notes/src/main.tsx`（界面与同步流程）。
