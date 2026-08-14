# AI Code Tutor IDE — Alpha 0.14

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并能够沿真实项目调用链跨文件跳着讲。



## Alpha 0.14 新增：代码旁 / 行号旁便签二选一

1. 持久代码便签默认显示在**代码行末附近**：`代码……  📝`，不会再强制放在最左侧行号区域。
2. 编辑器标签栏新增“便签：代码旁 / 行号旁”选择器；喜欢 Alpha 0.13 的 gutter 方式时可以随时切回，选择会本地记住。
3. 代码旁模式会读取 Monaco 当前行真实行尾坐标，再把 `＋ / 📝` 放到代码末尾后的空白处；如果当前可视区域没有足够空间，就不硬盖在代码字符上。
4. 便签内容与 Alpha 0.13 完全共用同一份持久数据，所以切换显示方式不会复制或丢失便签。
5. 便签编辑框改成紧凑 Popover：只显示 `代码便签 · Lxx`，不再让完整路径占一整行；保存、删除按钮不会被裁切。
6. Popover 会优先贴着便签标记展开，右侧空间不足时自动翻到左侧，底部空间不足时自动翻到上方。
7. `PROJECT / NAVIGATE / AI TUTOR` 三组命令区这次同时补齐顶部和底部留白，分组标签、按钮、下方分隔线都有一致间距。

## Alpha 0.13 新增：持久代码便签

1. 光标所在行的 Monaco glyph margin 会显示一个轻量 `＋`；点击即可在该代码行创建便签。
2. 已保存便签显示为 `📝` 标记，点击重新打开，可继续编辑或删除。
3. 便签适合记录代码理解、TODO、疑问、AI 教学总结，不会写进源码。
4. 便签通过 Electron IPC 保存到 `userData/ai-code-tutor/code-notes.json`，关闭 IDE 或重新运行 `npm run dev` 后仍然存在。
5. 便签按真实项目根目录 + 相对文件路径隔离，不同项目同名文件不会混在一起。
6. 除行号外还保存当前行代码作为 `anchorText`；重新打开文件时会先检查原行，再在附近 ±50 行和当前文件内寻找同一段代码，减少前面插入/删除代码后便签错位。
7. `Ctrl+Enter` 快速保存，`Esc` 关闭便签。
8. 顺便把 `PROJECT / NAVIGATE / AI TUTOR` 小标题与按钮之间的垂直距离拉开，不再贴在按钮边缘。

## Alpha 0.12 新增：工作台整理 + 近身 Tutor + Ctrl+Click 提示

1. 顶部操作区拆成更像桌面 IDE 的两层：上层保留品牌、状态、语音与 Key；下层按 `PROJECT / NAVIGATE / AI TUTOR` 分组。
2. 语音语言、具体声音、语速收进“语音设置”菜单，避免所有控件挤成一长排。
3. Alpha 0.11 的真实编辑与 `Ctrl+S` 写回原文件继续保留。
4. Tutor 不再住在独立 300px Rail；角色重新进入 Monaco 代码区域，并跟随正在讲解的目标行移动。
5. 角色会检查目标行上下两行最远的代码位置，优先站在代码末尾后的空白处；空间不够时自动退到 gutter，因此靠近代码但不压住代码字符。
6. 角色气泡改成编辑器顶部的紧凑字幕条，并通过 Monaco 顶部 padding 留出空间，不盖住第一行代码。
7. Dart 的 `Ctrl+Click` 继续使用 Dart Analysis Server 做真实 Definition 跳转。
8. 按住 `Ctrl` 悬停 Dart 符号时，符号会变成蓝色下划线并显示跳转提示，再点击执行语义跳转，更接近 VS Code 的交互反馈。

## Alpha 0.11：真实保存 + Ctrl+Click

1. Monaco 中的修改可以通过 `Ctrl+S` 真正写回当前项目里的原文件。
2. 当前文件修改后显示 `● 未保存 · Ctrl+S`，保存成功后恢复 `✓ 已保存`。
3. 切换文件会保留尚未保存的 Monaco 内存版本。
4. Dart 文件支持 `Ctrl+Click`，通过 Dart Analysis Server 的 Definition 跨文件跳到真实定义位置。
5. Alpha 0.11 首次把 Tutor 移入独立 Rail；Alpha 0.12 再把它改成代码区内的动态避让。

## Alpha 0.10 新增：Windows 原生语音 + 启动恢复

1. Windows 版语音从 Chromium `speechSynthesis` 升级为 **Windows.Media.SpeechSynthesis** 优先。
2. 新增“具体声音”选择：先选语言，再从该语言真正可用的系统 voice 中选择老师嗓音。
3. Windows 原生 TTS 由 Electron Main 负责调用，Renderer 只收到已经合成好的音频，不直接获得系统权限。
4. 非 Windows 开发环境仍保留 Web Speech fallback。
5. 语音开关、语言、具体声音与语速会保存到 Electron `userData` 下的应用状态文件。
6. 重新启动 IDE 后会自动恢复上次打开的项目。
7. 自动恢复上次正在看的文件；如果文件已经不存在，则回退到项目默认入口文件。
8. OpenAI API Key 不再只存进程内存：使用 Electron `safeStorage` 加密后写入本机状态；Windows 下由当前用户的 DPAPI 保护。
9. API Key 对话框支持覆盖保存与“清除已保存 Key”。
10. 顶部工具栏改成真正可收缩/横向滚动的操作带，并压缩状态文字，避免右侧按钮被窗口边缘裁掉。

## Alpha 0.9：多语言系统语音

1. 顶部新增语音语言下拉框。
2. 支持简体/繁体中文、英语、越南语、俄语、吉尔吉斯语、土耳其语、马来语等语言预设。
3. Alpha 0.9 使用 Chromium `speechSynthesis.getVoices()` 检测声音；在部分 Windows 机器上会看不到 Narrator / Natural voice，因此 Alpha 0.10 将 Windows 主路径改为原生 TTS。

## Alpha 0.8：角色语音教学

1. 角色每次跳到 `TutorMove` 目标后，会直接朗读该步骤的 `speech`。
2. AI / Dart 语义教学路线变成：`跳到代码 → 高亮 → 显示气泡 → 朗读完 → 再跳下一段`。
3. 支持语音开关与语速。
4. 角色朗读时嘴巴与天线进入说话动画状态。

## Alpha 0.7

1. `AI 理解函数` 支持选中整个 Dart 函数、函数名、或把光标放在函数体内部。
2. 通过 `textDocument/documentSymbol` 自动找到 Function / Method / Constructor。
3. 左侧项目文件夹默认折叠；Tutor 跳转时只展开目标文件祖先路径。

## Alpha 0.6

1. 新增 `🧠✨ AI 理解函数`。
2. 支持 `完整功能链 / 谁调用它 / 它调用谁`。
3. Dart Analysis Server 先建立真实 Call Hierarchy。
4. AI 只能选择 LSP 已返回的真实节点，再生成 `TutorMove[]` 跨文件教学。

## 运行

```bash
npm run typecheck
npm run dev
```

Alpha 0.14 没有新增 npm 包，所以从 Alpha 0.13 升级不需要重新 `npm install`。

Dart 语义分析依赖本机 Dart SDK：

```bash
dart --version
```

## Alpha 0.14 重点测试

1. 打开真实项目，把“便签”模式设为“代码旁”，移动光标到短代码行，确认 `＋` 出现在该行代码末尾附近，而不是行号区。
2. 点击 `＋` 写入内容并保存，确认该处变成 `📝`；再点 `📝` 能重新编辑。
3. 把模式切成“行号旁”，确认同一份便签出现在 Alpha 0.13 的 gutter 位置；再切回“代码旁”，内容不丢。
4. 关闭并重新运行 IDE，确认便签内容和“代码旁 / 行号旁”选择都保留。
5. 打开靠近编辑器右侧或底部的便签，确认紧凑 Popover 会自动换边，不再裁切保存按钮。
6. 确认 `PROJECT / NAVIGATE / AI TUTOR` 标题上方和按钮下方都有明显但不过大的留白。
7. 回归测试：角色仍避开代码；Dart Ctrl+Click 仍有蓝色下划线反馈并跳到真实 Definition；`Ctrl+S` 仍真正写回原文件。

Alpha 0.10 的会话恢复仍然保留：关闭再执行 `npm run dev`，应自动恢复上次项目、文件、语音设置和加密保存的 API Key。

## Windows 原生语音链

```text
TutorMove.speech
        ↓
VoiceController
        ↓ IPC
Electron Main
        ↓
Windows.Media.SpeechSynthesis
        ↓
指定 Language + Voice + SpeakingRate
        ↓
SpeechSynthesisStream (audio/wav)
        ↓ IPC
Renderer Audio
        ↓
角色嘴型动画 + 朗读
```

## 本地状态与 API Key

普通偏好会写入 Electron 的 `userData` 应用目录：

```text
lastProjectRoot
lastOpenFile
voice.enabled
voice.language
voice.voiceId
voice.rate
```

API Key 不以明文保存。保存时：

```text
OpenAI API Key
↓
Electron safeStorage
↓
Windows DPAPI
↓
加密后的字节再写入 state.json
```

清除 Key 可以直接在 IDE 的 `🔑 API Key` 对话框中完成。

## 当前能力

```text
真实项目文件树
+ Monaco Editor
+ 代码区近身 Tutor（代码尾部空白 / gutter 自动避让）
+ 项目级文本导航
+ Dart Definition / References / Call Hierarchy
+ AI 组织真实语义教学链
+ 角色跨文件跳跃
+ Windows 原生 TTS
+ 会话恢复
+ Ctrl+S 真实磁盘保存
+ Dart Ctrl+Click 语义跳转
+ 持久代码便签（不污染源码）
```

## 当前限制

- 完整语义语言目前仍以 Dart / Flutter 为主。
- Windows 原生 TTS 只能使用 Windows SpeechSynthesizer 真正枚举到的系统语音；Narrator 专用 voice 是否可供普通应用使用仍由 Windows 决定。
- 尚未做麦克风语音提问和“等等 / 继续 / 上一个”等语音控制。
- 已支持当前文件 Ctrl+S 真实保存，但尚未做“另存为”、关闭未保存确认、外部文件冲突处理。
- 尚未做终端、运行/编译、调试器和 Git UI。
