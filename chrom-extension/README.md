# 剪巢 ClipNest 连接器（浏览器扩展）

ClipNest（剪巢）桌面端与浏览器之间的桥。用户在浏览器表单输入框聚焦时，扩展把**字段上下文**上报给本机 ClipNest；ClipNest 的 Jev 智能填充管线从剪贴板历史中筛选合适内容，通过扩展**回填到输入框**或给出**建议浮层**。通信走本地 WebSocket（`ws://127.0.0.1:端口`，token 鉴权），全程不经过任何外部服务器。

- Manifest V3，Edge / Chrome 通用（Edge 为 Chromium 内核，直接加载同一份代码）
- 纯原生 JS / CSS / HTML，零第三方依赖、零 CDN
- 协议 v1，与桌面端共用同一份契约（`src/shared/types.ts` 的 `ExtToAppMessage` / `AppToExtMessage`）

## 文件清单

| 文件 | 职责 |
|---|---|
| `manifest.json` | MV3 清单：权限（storage / activeTab）、`<all_urls>` 主机权限（表单检测需要）、后台 SW、内容脚本（所有框架 document_idle 注入）、popup、图标 |
| `background.js` | Service Worker：维护 WebSocket 连接、连接后立即发 hello、指数退避重连（1s→2s→4s→8s，封顶 30s，带抖动）、25s 心跳 / 120s 无 pong 强断、`fill`/`suggest` 广播给所有 http(s) 标签页、`auth-fail` 停止重连风暴 |
| `content.js` | 注入所有页面：字段检测（focusin/focusout 300ms 防抖）、输入变化 180ms 更新候选、稳定 FieldCtx 生成、按字段类型执行填充并派发 input/change 事件、建议浮层（最多 5 条、Esc/外点/失焦关闭、事件不冒泡到页面） |
| `popup.html` / `popup.js` | 弹窗：连接状态（带颜色圆点）、服务地址 / 令牌编辑、自动填充开关、保存并重连、连通性检测（ping→pong，2s 超时） |
| `icons/icon16/48/128.png` | 扩展图标（品牌紫 #726CFF 圆角方形 + 白色简化剪贴板图形，4x 超采样抗锯齿） |
| `scripts/make-icons.cjs` | 重新生成图标：`node scripts/make-icons.cjs`（纯 zlib 写 PNG，无第三方库） |
| `scripts/smoke-extension.cjs` | 冒烟测试：协议结构校验 + 模拟扩展客户端连接 `ws://127.0.0.1:9377` 跑完整会话 |

## 安装

### Edge

1. 地址栏输入 `edge://extensions` 回车
2. 打开左侧"开发人员模式"开关
3. 点"加载解压缩的扩展"，选择本目录（`clipnest\chrom-extension`）
4. 点工具栏拼图图标，把"剪巢 ClipNest 连接器"固定到工具栏

### Chrome

1. 地址栏输入 `chrome://extensions` 回车
2. 打开右上角"开发者模式"开关
3. 点"加载已解压的扩展程序"，选择本目录（`clipnest\chrom-extension`）
4. 将扩展固定到工具栏

## 配置（两侧）

**ClipNest 桌面端**：设置 → 智能 → 浏览器扩展连接 → 打开"启用"开关 → 复制令牌。

**扩展 popup**：点工具栏图标 →

- 服务地址：默认 `ws://127.0.0.1:9377`（桌面端改了端口就同步改这里）
- 连接令牌：粘贴桌面端复制的令牌
- 自动填充：勾选后聚焦输入框才会上报字段上下文（不勾则完全不上报）
- 点"保存并重连"，状态圆点变绿即连接成功；也可点"连通性检测"单独验证

## 使用流程

1. 在任意网页聚焦表单输入框（邮箱、电话、搜索框等）
2. ClipNest 的 Jev 管线收到字段上下文后匹配剪贴板历史：
   - 命中且合适 → 直接回填输入框（受 React/Vue 框架管理的输入框同样生效）
   - 当前内容只有一项可靠候选 → 直接回填
   - 有多项候选 → 输入框下方弹出"剪巢建议"浮层；当前内容优先，全库命中标注为“全库候选”
   - 用户继续输入 → 候选按输入内容实时收敛，不自动覆盖已有文字
3. 浮层操作：点击条目填充；Esc / 点击空白处 / 字段失焦关闭
4. 状态不对时先看 popup：圆点灰色=未连接、橙色=连接中、绿色=已连接、红色=令牌不正确

## 隐私与边界

- 字段上下文（类型/名称/label 等）只发往**本机** `127.0.0.1` 的 ClipNest，扩展不含任何远程请求
- **密码字段（`type=password`）永远不上报、永远不填充**（硬规则，双重校验）
- 上报的字段值截断到 500 字符、label 截断到 100 字符，仅作匹配线索

## 开发与自验

```bash
cd clipnest/chrom-extension

# 重新生成图标
node scripts/make-icons.cjs

# 冒烟测试（协议结构校验 15 项 + 模拟客户端连通性会话；应用未启动时容忍并清晰报告）
node scripts/smoke-extension.cjs

# 语法检查
node --check background.js && node --check content.js && node --check popup.js
```

改完代码后到 `edge://extensions`（或 `chrome://extensions`）点该扩展的"重新加载"图标，并刷新已打开的网页。

## 协议速查（v1）

扩展 → 应用：`hello`（连接后首条，带 token）/ `ping` / `field-focus` / `field-blur` / `fill-result`
应用 → 扩展：`welcome` / `pong` / `auth-fail` / `fill`（replace|append）/ `suggest`（最多 5 条 `{id,title,preview,value,scope}`）

## 已知限制

- **`all_frames` 行为**：内容脚本注入所有 iframe（含跨域）。`fill`/`suggest` 由后台广播给所有 http(s) 标签页，仅"当前持有焦点字段"的那个帧会执行并回报 `fill-result`；若字段在应用下发 fill 前已失焦，则不会有任何帧回应（桌面端需自行超时）。
- **SPA 路由**：字段检测基于 `focusin` 事件，路由切换后新聚焦字段会自然重新上报，PageCtx 每次聚焦时实时读取，无需额外处理；但浮层不会在路由切换时自动关闭（会有 focusout 兜底）。
- **shadow DOM**：开放 shadow root 内的字段可通过 `composedPath` 识别；闭合 shadow root 无法进入。
- **建议点击的取值**：`suggest.value` 携带完整填充值，`preview` 仅展示上下文；`scope` 区分当前内容与全库候选。
- **maxLength**：填充时按字段 `maxLength` 截断；contenteditable 无原生 maxLength 概念，不做截断。
- **SW 挂起**：Service Worker 挂起后定时器与 socket 失效，扩展用 30s 闹钟唤醒体检并补连；极端情况下重连会有最多约 30s 延迟。
- **页面自带快捷键**：浮层打开期间会拦截页面自身的 Esc 处理（浮层优先）。
