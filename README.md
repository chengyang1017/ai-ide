# AI Code Tutor IDE — Alpha 0.10

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并能够沿真实项目调用链跨文件跳着讲。

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

Alpha 0.10 没有新增 npm 包，所以从 Alpha 0.9 升级不需要重新 `npm install`。

Dart 语义分析依赖本机 Dart SDK：

```bash
dart --version
```

## Alpha 0.10 重点测试

第一次运行：

1. `📂 打开项目`，打开一个真实项目。
2. `🔑 API Key`，输入 Key 并点击“加密保存到本机”。
3. 选择语音语言。
4. 在新增的 voice 下拉框里选择一个具体声音。
5. 点击 `🤖 老师跳到光标`，确认角色用所选声音朗读。
6. 正常关闭 IDE。

第二次运行：

```bash
npm run dev
```

理想结果：

```text
自动恢复上次项目
        +
自动恢复上次文件
        +
语音语言 / voice / 语速保持
        +
API Key 按钮直接显示已保存
```

不应该再次要求选择项目或重新输入 API Key。

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
+ 角色覆盖在代码区域
+ 项目级文本导航
+ Dart Definition / References / Call Hierarchy
+ AI 组织真实语义教学链
+ 角色跨文件跳跃
+ Windows 原生 TTS
+ 会话恢复
```

## 当前限制

- 完整语义语言目前仍以 Dart / Flutter 为主。
- Windows 原生 TTS 只能使用 Windows SpeechSynthesizer 真正枚举到的系统语音；Narrator 专用 voice 是否可供普通应用使用仍由 Windows 决定。
- 尚未做麦克风语音提问和“等等 / 继续 / 上一个”等语音控制。
- 尚未做完整编辑器保存、终端、调试器和 Git UI。
