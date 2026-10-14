# PWA 是什么

PWA（Progressive Web App，渐进式 Web 应用）仍然是通过网址访问的网页应用。它可以借助浏览器提供的能力，在支持的设备上添加到主屏幕、以接近独立应用的窗口打开，并缓存部分资源供离线使用。安装入口和实际能力会因浏览器及操作系统而异。

## 本项目如何实现

`pwa-apps` 把笔记和照片布局作为两个独立的 PWA 发布在同一个 GitHub Pages 站点下：

| 组成 | 在本项目中的作用 |
| --- | --- |
| `manifest.webmanifest` | 分别声明应用名称、图标、启动地址、页面范围和独立窗口显示方式。 |
| `sw.js`（Service Worker） | 由 `vite-plugin-pwa` 在构建时生成，缓存应用页面和静态资源，让已访问的应用在离线时仍有机会打开。 |
| HTTPS | GitHub Pages 提供安全连接，供浏览器使用 Service Worker 等 PWA 能力。 |

两个应用的启动路径和 Service Worker 范围分别位于 `/pwa-apps/notes/` 与 `/pwa-apps/photo-layout/`，因此可以分别添加到主屏幕。仓库改名时，构建路径也要相应调整。

## 安装、离线与数据

先联网打开应用，再使用浏览器的“添加到主屏幕”或“安装应用”功能。浏览器需要先成功取得并缓存资源；首次访问之前无法离线打开。浏览器也可能清理缓存，因此不能把离线缓存当成永久保存的数据。

- **笔记：** 页面资源缓存与笔记数据是两回事。笔记正文保存在当前浏览器的 `localStorage`，离线时可以查看和编辑；手动同步到 GitHub 私有仓库需要联网。
- **照片布局：** 已缓存的页面可以离线打开，但选入的照片只在当前页面会话中使用，刷新后需要重新选择。

安装应用不会自动备份笔记。清除浏览器的站点数据可能同时删除本地笔记、同步配置和离线缓存。需要跨设备保存笔记时，请使用笔记应用中的 GitHub 同步功能；同步方式见 [项目 README](../README.md#笔记数据与同步)。

## 开发时如何检查

运行 `npm run build` 后，两个应用各自的 `manifest.webmanifest` 和 `sw.js` 会出现在 `dist/notes/`、`dist/photo-layout/`。完整的安装和离线行为应在构建后的站点上检查；开发服务器的表现不一定与发布版本相同。GitHub Pages 的 HTTPS 地址适合在手机上验证。

延伸阅读：[MDN：什么是 PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)、[安装 PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[离线与后台运行](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)。
