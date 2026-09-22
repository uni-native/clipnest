# 剪巢产品演示分镜

**Format:** 1920×1080，16:9，30fps
**Audio:** Kokoro 中文旁白 + 本地原创电子氛围配乐 + 轻量界面音效
**VO direction:** 年轻女性，冷静、亲切、简短停顿清晰，接近 Apple 产品影片的克制表达
**Style basis:** DESIGN.md
**Duration:** 34 秒

## Global guardrails

- 主相机保持缓慢、连续、稳定，快速动作只出现在内容卡片汇聚和智能匹配瞬间。
- 每个段落至少包含背景光场、中景真实界面、前景文字或线条三层空间。
- 主转场采用柔和 blur crossfade 与连续 zoom through；智能匹配高潮使用一次 circle iris。
- 真实截图不平铺，统一放入有景深的设备面板，并使用轻微 Ken Burns 运动。
- 配乐从单一玻璃音符开始，逐步加入脉冲、柔和低频与高频颗粒，在品牌落版时收束。

## Asset audit

| Asset | Type | Assign to Beat | Role |
|---|---|---|---|
| `assets/clipnest-icon.png` | 品牌图标 | 1、6 | 开场空间核心与结尾品牌落版 |
| `assets/panel-horizontal.png` | 桌面界面 | 2 | 剪贴卡片流主视觉 |
| `assets/panel-vertical.png` | 桌面界面 | 2 | 横竖布局空间切换 |
| `assets/settings-browser.png` | 设置界面 | 3、5 | 网页智能填充和本地连接证明 |
| `assets/settings-intelligence.png` | 设置界面 | 3 | 智能层级背景 |
| `assets/web-analytics.png` | 网页界面 | 4 | 今日分析主界面 |
| `assets/web-content.png` | 网页界面 | 4 | 内容管理纵向延展 |

## BEAT 1 — 思考不被打断，0.00–3.20s

**VO:** “复制，不该打断思考。”

**Concept:** 画面从接近白色的空间开始，几段文字、链接、图片缩略块像失重纸片从镜头两侧滑过。它们没有混乱坠落，而是被一条蓝紫轨迹轻柔牵引，最终在画面中心聚合成剪巢图标。

**Visual:** 背景是 `#F5F4FA` 与局部 `#EEECFF` 光晕；前景有六枚内容碎片、细小来源标签、一个描边路径和品牌图标。主标题“复制，不该打断思考”从宽字距逐步收紧。镜头在最后一秒向图标缓慢推进。

**Techniques:** SVG path drawing、CSS 3D 漂浮、逐词动效。

**Transition:** 图标中心变成圆形镜头，circle iris 推入下一段。

**SFX:** 单个玻璃音、轻柔吸附声。

## BEAT 2 — 自动归巢，3.20–6.20s

**VO:** “剪巢，让每一次复制，自动归巢。”

**Concept:** 横向剪贴板面板像一条洁白的信息轨道掠过镜头。卡片按内容类型自动寻找位置，重复内容叠合成一张，横向轨道随后顺滑折叠为右侧竖向面板，体现布局和长期使用的秩序感。

**Visual:** `panel-horizontal.png` 占画面 78% 宽度并带轻微透视；若干蓝紫高亮框沿卡片边缘流动；`panel-vertical.png` 在右侧以深度层出现。背景漂浮少量“文本、链接、图片”标签和使用次数数字。

**Techniques:** CSS 3D、卡片级联、速度匹配转场。

**Transition:** 相机沿内容轨道向右 whip pan，模糊峰值 16px 后进入表单空间。

**SFX:** 三次轻微卡片归位声，转场有柔和空气掠过。

## BEAT 3 — 理解表单，6.20–11.00s

**VO:** “它理解你正在填写什么，并把最合适的内容，送到指尖。”

**Concept:** 画面进入一个极简表单空间。邮箱输入框获得焦点时，历史内容不是堆成列表，而是先按字段要求聚焦，再呈现一个相关候选和一个明确标识的跨库候选；唯一结果直接进入输入框。

**Visual:** 左侧为动画构建的“邮箱地址”“个人主页”“手机号码”字段；右后方漂浮 `settings-browser.png` 和 `settings-intelligence.png`。候选胶囊沿一条弧线进入，第一位带“字段相关”，第二位带“来自全库”。阈值 0.60 作为细小刻度浮现。

**Techniques:** MotionPath、逐字输入、候选磁吸排序、SVG 连接线。

**Transition:** 被填入的邮箱文字扩散成蓝紫数据点，blur crossfade 到分析图表。

**SFX:** 光标点击、候选吸附、单一确认音。

## BEAT 4 — 网页功能导览，11.00–24.84s

**VO:** “打开网页版，可以看清今天复制了多少，什么时段最频繁，内容主要来自哪里。切到内容管理，可以搜索，按类型筛选，再选择不需要的内容统一清理。”

**Concept:** 直接展示真实网页版操作。先查看今日分析，再切换内容管理，输入关键词，按链接类型筛选，选择结果并悬停批量清理。演示不执行删除，也不展示含真实手机号的历史行。

**Visual:** `assets/web-tour/web-tour.webm` 放入克制的浏览器窗口。左下角依次出现“看清一天”“找到内容”“轻松整理”，真实鼠标轨迹保持可见。

**Techniques:** 真实网页录屏、鼠标点击反馈、阶段提示、缓慢镜头推进。

**Transition:** 顶部绿色“数据仅在本机”圆点放大为保护镜片，focus pull 进入隐私段落。

**SFX:** 柔和节拍加入，数据柱点亮时有轻微木质点击。

## BEAT 5 — 本地而安心，24.84–28.00s

**VO:** “所有数据，只留在本机。”

**Concept:** 画面突然更安静。网页版、浏览器连接和剪贴面板三层界面悬浮在半透明保护球中，球体边缘只有一圈绿色连接光。外部网络线条靠近后自然绕开，所有内容仍在内部平稳流动。

**Visual:** `settings-browser.png` 居中，`web-analytics.png` 与 `panel-vertical.png` 在后景形成空间层；“仅本机访问”“零网络上传”两个短标签沿球体边缘出现。背景留白明显增加。

**Techniques:** 焦点拉移、SVG 护盾路径、慢速视差。

**Transition:** 保护球收缩为品牌图标内的圆孔，zoom through 进入结尾。

**SFX:** 节拍短暂抽离，只保留温暖低频与一声清脆确认音。

## BEAT 6 — 品牌收束，28.00–34.00s

**VO:** “剪巢。把零碎，收进秩序。”

**Concept:** 所有界面在镜头远处折叠成几片白色纸张，落入蓝紫巢形图标。图标稳定悬停，品牌名与一句话在右侧展开，最后留出一秒纯净呼吸。

**Visual:** `clipnest-icon.png` 占画面高度 34%；文字“剪巢 ClipNest”与“把零碎，收进秩序”形成清晰双焦点。背景只有极淡的蓝紫径向光和一条水平细线。

**Techniques:** 3D 折叠、逐字排版、音频响应式 3% 呼吸。

**Final:** 所有元素在最后 0.7 秒轻柔淡出到 `#F5F4FA`。

**SFX:** 最终和弦与单个玻璃尾音。

## Production architecture

```text
clipnest-launch/
├── index.html
├── DESIGN.md
├── SCRIPT.md
├── STORYBOARD.md
├── narration.txt
├── narration.wav
├── transcript.json
├── underscore.wav
├── assets/
├── capture/
├── compositions/
├── snapshots/
└── renders/
```
