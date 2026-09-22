# ClipNest（剪巢）开发契约

本地优先的智能剪贴板管理器。Electron 38 + electron-vite + Vue 3 + TypeScript + better-sqlite3(FTS5) + koffi(Win32)。

## 铁律

1. **类型唯一来源**：`src/shared/types.ts`。任何模块不得重复定义其中的类型；需要新类型就加进去（只加不改名）。
2. **不碰别人的文件**：每个子代理只写自己名下的文件（见下文"模块归属"）。需要别人提供的能力，按契约函数签名调用。
3. **零网络**：除 `core/updater.ts`（自建更新源）外，任何模块不得发起网络请求。渲染层 CSP 已是 `connect-src 'none'`。
4. **数据库**：只用 `core/paths.ts` 导出的 `dbPath`（`%APPDATA%/clipnest-data/clipnest.db`）。**严禁**读写原版 `~/.clipboard/db.sqlite`。
5. **平台分支**：只允许出现在 `src/main/platform/` 内（win32 实现 + darwin stub）。其他模块出现 `process.platform === 'darwin'` 判分支属违规。
6. **错误处理**：所有 IPC handler 不得抛异常穿透（返回 false / 空结果并 console.error）。所有文件操作 try/catch。
7. **代码风格**：TS strict；不用 any（除 preload subscribe 的内部 listener）；函数 ≤ 60 行；注释只写"为什么"，不写"是什么"。
8. **验证**：交付前必须运行 `npx tsc --noEmit -p tsconfig.node.json`（主进程代理）或 `npx vue-tsc --noEmit -p tsconfig.web.json`（渲染代理），自己名下的文件零错误；其他代理未完成的文件报错可忽略，但要在交付说明里列出。

## 模块归属与契约

| 模块 | 负责人 | 必须导出 |
|---|---|---|
| `src/main/core/paths.ts`、`src/shared/*`、`src/preload/*`、`src/main/index.ts`、`src/main/ipc/index.ts`、构建配置 | 主控（已完成，禁止修改） | — |
| `src/main/core/db.ts`、`src/main/core/store.ts`、`src/main/core/schema.ts` | DB 代理 | `initStore(): ClipStore` |
| `src/main/capture/**` | 采集代理 | `startCapture(store, emit): { stop(): void }` |
| `src/main/platform/**`、`src/main/paste/**` | 粘贴代理 | `getPlatform(): PlatformAdapter`；`createPasteEngine(): PasteEngine` |
| `src/main/windows/**`、`src/main/core/shortcuts.ts`、`retention.ts`、`updater.ts` | Shell 代理 | 见 `ipc/index.ts` 与 `main/index.ts` 中的调用签名 |
| `src/renderer/**` | 渲染代理 | Vue 应用，入口 `src/renderer/src/main.ts` |

已存在的占位文件给出了**精确的函数签名**，替换时保持签名不变（可加参数默认值，不可改调用方式）。

## 关键技术事实（已验证）

- koffi 可用（预编译，无需 VS）：`user32.dll` 的 `GetClipboardSequenceNumber()` / `GetForegroundWindow()` / `GetWindowTextW()` / `SetForegroundWindow()` / `SendInput()` 均已验证可调。INPUT 结构体 32 字节。
- `node:sqlite` 在 Electron 中需实验 flag，**不可用**；统一 better-sqlite3（N-API 预编译，已装好 v12）。
- Electron clipboard API：`clipboard.availableFormats()` / `readText()` / `readHTML()` / `readImage().toDataURL()` / `readBuffer('FileNameW')`（ucs2，需去 `\0`）/ `write({text, html})` / `writeImage(nativeImage)`。
- Windows 文件剪贴板：`readBuffer('FileNameW').toString('ucs2')` 得到路径；写入需 DROPFILES（用 koffi 分配全局内存，见下）。

## 关键实现要求

### DB 层
- better-sqlite3，打开时 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;`
- schema：`posts`（字段见 `shared/types.ts` 的 `Post`，`hash TEXT UNIQUE`、`last_used_at INTEGER`）、`post_fts`（FTS5 外部内容表，`content=''` 空 content 模式 + 触发器同步 title/preview）、`groups`、`rules`、`settings`（单行 json + schema 版本）、`post_vectors`（预留）。
- 索引：`posts(last_used_at DESC, id)`、`posts(group_id)`、`posts(type)`、`posts(pinned)`。
- `queryPosts`：keyset 游标分页 `WHERE last_used_at < ? OR (last_used_at = ? AND id < ?)`，默认 limit 20；`keyword` 走 FTS5 MATCH（转义 `"` 为 `""`，关键词加 `*` 前缀）；`groupId: 'none'` → `group_id IS NULL`。
- `insertPost`：`INSERT ... ON CONFLICT(hash) DO UPDATE SET last_used_at=excluded.last_used_at, use_count=use_count+1`，返回 `{post, created}`（conflict 时读回该行）。
- `saveSettings`：深合并到现有设置后写回，返回完整 Settings。
- `vacum`→`vacuum()`：`PRAGMA incremental_vacuum` 前先 `PRAGMA auto_vacuum=INCREMENTAL`（建库时设）。
- 迁移：`_meta(key TEXT PRIMARY KEY, value TEXT)` 存 `schema_version`；`initStore()` 时按版本执行建表/补列（幂等）。

### 采集管线（capture/）
- `watcher.ts`：koffi `GetClipboardSequenceNumber()` 每 80ms 轮询（纯 Win32 调用，不读内容，开销可忽略）；序列号变化 → 读快照 → 进入有界队列（容量 64，满了丢新并 console.warn）。
- `classify.ts`：按 `availableFormats()` 判定 image / image-file / file / folder / text|link（URL 正则 `/^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i`）。
- `normalize.ts`：文本去 `\0`；图片 dataURL 落盘到 `imagesDir`（文件名 `img_<hash前16>.png`）并算 sha256；富文本保留 html + 生成 preview（去标签截断 120 字）；文件/文件夹存路径 JSON 到 `contentPath`；`sourceApp` 由前台窗口标题提取（取 ` - ` 前的常见模式，失败用完整标题，最长 40 字符）。
- `pipeline.ts`：`startCapture(store, emit)`：编排 监听→分类→归一化→`store.insertPost`→按 reason emit。**去重由 store 的 hash UPSERT 完成，不要先查后插**。
- 自粘贴防护：`paste/index.ts` 写入剪贴板前调用 capture 导出的 `markSelfWrite(hash)`；pipeline 见到相同 hash 且 800ms 内的快照直接跳过（**禁止**用全局时间锁丢真实复制）。

### 粘贴引擎（paste/）
- `writer.ts`：`writeText/writeHtml/writeImageFile/writeFilePaths`。file 路径写入用 koffi：`GlobalAlloc(GMEM_MOVEABLE)` + `GlobalLock` 填 `DROPFILES` 结构（`pFiles=20, pt.x=0, pt.y=0, fNC=0, fWide=1`）+ 双 `\0` 结尾的 UTF-16 路径 + `GlobalUnlock` + `SetClipboardData(CF_HDROP=15)`。
- `foreground.ts`：`saveForeground()` 记录 `GetForegroundWindow()` 句柄；`restoreForeground(h)`：`SetForegroundWindow` + 失败时用 `AttachThreadInput` 技巧（输入线程附加后再 SetForegroundWindow）。
- `keyin.ts`：`SendInput` 合成 `Ctrl+V`（KEYEVENTF_KEYUP=0x0002，VK_CONTROL=0x11，VK_V=0x56；先按 Control 再按 V 再释放）。
- `engine.ts`：`pastePost(post)`：保存前台 → 按类型写剪贴板（image→writeImageFile 落盘路径；file/folder→writeFilePaths；text/link→writeHtml/writeText）→ `restoreForeground` → 延时 60ms → `sendPasteKeys` → `markSelfWrite` → `store.touchPost(id)`。**任何一步失败都要保证剪贴板内容已写入且不崩溃**（try/finally）。
- `enqueueCopy()`：把当前剪贴板内容入队（内存数组，上限 9），返回队列长度；`flushQueue()` 依次粘贴队首内容（每次 paste 间隔 150ms）。

### Shell 层（windows/ + shortcuts/retention/updater）
- `panel.ts`：主面板窗。透明、无边框、`skipTaskbar`、`alwaysOnTop`、`setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`。布局：`vertical` → 宽 290 高=屏幕高、贴右缘；`horizontal` → 宽=屏宽、高 340、贴底。失焦 `blur` → 隐藏（发 `evtHide`）。加载 `out/renderer/index.html`。首次显示按设置 layout 定位。
- `settings.ts`：设置窗 810×580、frame:false、居中、`skipTaskbar:false`，加载同一 index.html 但 hash 路由到 `#/settings`（渲染层用 hash 路由区分面板/设置，见渲染契约）。
- `tray.ts`：托盘图标用 `resources/iconTemplate_win.png`（占位 1×1 png 也行，但必须有）；菜单：显示/隐藏（accelerator=设置值）、偏好设置、退出。
- `shortcuts.ts`：`globalShortcut` 统一注册 showOrHide / quickPaste+1..9 / prev/next group；`setShowOrHideHotkey(key)`：先 unregister 旧的，注册新的，失败回滚旧的并返回 false；注册成功写回 store settings。
- `retention.ts`：`initRetention(store, settings)` 按 `historyCache`（`infinity`/`day`/`week`/`month`/`quarter`/`half`/`year`）`setInterval` 每小时检查一次，过期 `clearHistoryBefore` + `vacuum()`。
- `updater.ts`：electron-updater，`autoUpdater.autoInstallOnAppQuit=false`，feed URL 从 `process.env.CLIPNEST_UPDATE_URL` 或默认 `https://github.com/liuhao/clipnest/releases/latest/download` 读取（generic provider）；启动后延迟 10s 后台 `checkForUpdates()`，`update-downloaded` 时托盘气泡 + 通知渲染层。**不自动安装**。

### 渲染层（renderer/）
- hash 路由（自写 30 行足够，不引 vue-router）：`#/` 面板，`#/settings` 设置页。`#/settings` 时 App 渲染 SettingsView，否则渲染面板。
- Pinia（已装 vue，需 `npm i pinia`——**由渲染代理自行安装**并写入 package.json）。
- 视图：`views/ClipboardView.vue`（主面板）、`views/SettingsView.vue`（设置，左侧导航：剪切板/快捷键/通用/智能）。
- 组件：`SearchBar`（防抖 200ms）、`PostList`（**自写虚拟滚动**：容器 scroll，只渲染可视区 ±5 缓冲，行高固定 64px；禁止引第三方虚拟列表）、`PostItem`（类型图标+标题+来源+时间+收藏星）、`GroupBar`（顶部分组横滑：全部/未分组/各分组+新建）、`QueueBanner`（L1 顺序队列提示：连按复制后显示"已收集 n 条，回车依次粘贴"）。
- stores：`usePostsStore`（列表/游标/加载更多/搜索/事件订阅）、`useGroupsStore`、`useSettingsStore`（主题/布局）、`useQueueStore`。
- 样式：**与原版保持一致**——浅色主题（`styles.css` 已定义 CSS 变量）、竖版右侧 290px 贴边、圆角 10px 白底、列表行 hover 高亮、选中品牌蓝。设置页左侧深灰导航 180px + 右侧白底表单。全部用原生 CSS（禁引 UI 组件库）。
- 交互：点击条目 = 粘贴（`api.posts.paste`）；回车 = 粘贴队首；Esc = 隐藏；↑↓ 移动选中；Ctrl+1..9 由主进程快捷键直接触发粘贴（监听 `onHotKey(n)` → 粘贴第 n 条）。
- 事件：订阅 `onPostCaptured`（插入列表头部）、`onPostTouched`（移到头部）、`onSettingsChanged`（应用主题/布局）、`onShow/onHide`（控制 CSS 动画类）。
- 图片条目：`<img :src="'clipnest-file://' + contentPath">`——不行，改用：主进程已把图片落盘，渲染层直接用 `nativeImage`？**不行**。正确做法：主进程 IPC `queryPosts` 返回的 Post 不带图片数据；渲染层用 `<img src="data:...">` 会太大。**约定：图片条目显示文件图标占位 + 尺寸，点击粘贴时不预览；P5 再做缩略图 IPC**。简单可靠优先。

## 构建与验证命令

```bash
cd C:\Users\liuhao\.zcode\workspace\default\clipnest
npx tsc --noEmit -p tsconfig.node.json      # 主进程类型检查
npx vue-tsc --noEmit -p tsconfig.web.json   # 渲染层类型检查
npx electron-vite build                     # 构建
npx electron . --smoke                      # 冒烟（4 秒后自动退出）
```

交付说明必须包含：改了哪些文件、类型检查结果、已知问题、给主控的集成备注。
