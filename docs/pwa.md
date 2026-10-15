# PWA 是什么

PWA（Progressive Web App，渐进式 Web 应用）仍然是通过网址访问的网页应用。它可以借助浏览器提供的能力，在支持的设备上添加到主屏幕、以接近独立应用的窗口打开，并缓存部分资源供离线使用。安装入口和实际能力会因浏览器及操作系统而异。

## 能使用哪些设备能力

PWA 可以调用浏览器开放的 Web API，获得一部分接近原生应用的能力。例如：

| 能力 | 常见用途 |
| --- | --- |
| 相机、麦克风、定位 | 拍照、录音、获取位置；使用时通常需要用户授权。 |
| 本地文件与系统分享 | 选择照片或文档、把内容分享到其他应用；部分平台也支持把 PWA 注册为分享目标或文件处理应用。 |
| 通知与后台任务 | 在支持的浏览器中显示系统通知、接收推送，或在网络恢复后执行后台同步。 |
| 桌面集成 | 显示桌面图标，从主屏幕启动，并以独立窗口打开。 |

这些能力并非安装 PWA 后就自动获得，也不是 PWA 独有：不少能力普通网页同样可以调用。每项能力都要由应用单独实现，并受浏览器、操作系统、HTTPS 和用户授权限制；尤其不能假设后台任务在所有手机上可靠执行。参见 [MDN 的 PWA 能力概览](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)与 [PWA API 参考](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Reference)。

**本项目目前实际用到的设备能力**是桌面安装、独立窗口和离线资源缓存。照片布局通过文件选择框读取本地照片，并在浏览器支持时使用系统分享面板发送生成的 JPG；文件选择也是普通网页能使用的 Web API。项目目前没有调用相机、定位、系统通知、推送或后台同步。笔记的 GitHub 同步由用户手动触发。

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
- **照片布局：** 已缓存的页面可以离线打开，排版、导出和系统分享在设备上进行；选入的照片只在当前页面会话中使用，刷新后需要重新选择。

安装应用不会自动备份笔记。清除浏览器的站点数据可能同时删除本地笔记、同步配置和离线缓存。需要跨设备保存笔记时，请使用笔记应用中的 GitHub 同步功能；同步方式见 [项目 README](../README.md#笔记数据与同步)。

## 开发时如何检查

运行 `npm run build` 后，两个应用各自的 `manifest.webmanifest` 和 `sw.js` 会出现在 `dist/notes/`、`dist/photo-layout/`。完整的安装和离线行为应在构建后的站点上检查；开发服务器的表现不一定与发布版本相同。GitHub Pages 的 HTTPS 地址适合在手机上验证。

延伸阅读：[MDN：什么是 PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)、[安装 PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[离线与后台运行](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)。
