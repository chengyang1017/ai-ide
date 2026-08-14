# AI Code Tutor IDE — Alpha 0.8

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并能够沿真实项目调用链跨文件跳着讲。

## Alpha 0.8 新增：角色语音教学

1. 角色每次跳到 `TutorMove` 目标后，会直接朗读该步骤的 `speech`。
2. 使用 Electron Renderer 的系统 `speechSynthesis`，不调用 OpenAI Audio API，因此**语音本身不需要 API Key**。
3. 优先选择 Windows 本机可用的中文语音；没有中文语音时回退到系统默认声音。
4. AI / Dart 语义教学路线现在变成：`跳到代码 → 高亮 → 显示气泡 → 朗读完 → 再跳下一段`。
5. 顶部新增 `🔊 语音开启 / 🔇 语音关闭`。
6. 新增 `0.8× / 1.0× / 1.2× / 1.4×` 语速控制。
7. 用户停止教学、切换文件、打开新项目或关闭 IDE 时，会立即取消当前语音，避免旧讲解继续播放。
8. 角色朗读时嘴巴与天线会进入说话动画状态。
9. 关闭语音后，导航仍保持原来的定时停留逻辑，不影响非语音使用方式。

## Alpha 0.7

1. `AI 理解函数` 不再要求精准点中函数名：支持选中整个 Dart 函数、只选函数名、或把光标放在函数体内部。
2. Electron 把 Selection 范围传给 Dart LSP，通过 `textDocument/documentSymbol` 自动找到最近的 Function / Method / Constructor，再从真实符号位置启动 Call Hierarchy。
3. 修复选中 `Future<void> foo() { ... }` 时误把 `Future` 当成语义根节点的问题。
4. 左侧项目文件夹默认全部折叠。
5. 角色 / AI 跨文件导航时只自动展开目标文件的祖先目录并滚动到当前文件。

## Alpha 0.6

1. 新增 `🧠✨ AI 理解函数`。
2. 支持 `完整功能链 / 谁调用它 / 它调用谁`。
3. Dart Analysis Server 先建立真实 Call Hierarchy。
4. IDE 读取真实语义节点附近的代码，再交给 AI 排教学顺序。
5. AI 只能选择 LSP 已返回的真实节点，不能编造文件和行号。
6. 最终生成 `TutorMove[]`，角色跨文件跳跃、高亮并讲解。

## 运行

```bash
npm run typecheck
npm run dev
```

Alpha 0.8 没有新增 npm 依赖，所以不需要重新 `npm install`。

Dart 语义分析依赖本机 Dart SDK：

```bash
dart --version
```

Windows 下 IDE 会自动从 `DART_BIN`、`FLUTTER_ROOT`、`where.exe dart` 与 PATH 中寻找 Flutter SDK 内真正可直接启动的 `dart.exe`。

## 语音测试

最简单的测试不需要 API Key：

1. 打开项目。
2. 把光标放到任意代码位置。
3. 确认顶部显示 `🔊 语音开启`。
4. 点击 `🤖 老师跳到光标`。
5. 角色跳到当前位置后，应该直接朗读气泡内容。
6. 修改语速，再点击一次观察速度变化。
7. 点击 `🔇 语音关闭` 后再次跳转，应只显示气泡、不播放声音。

完整 AI 调用链语音测试：

1. 打开 Flutter / Dart 项目。
2. 选中整个函数、函数名，或把光标放在函数体内。
3. 设置 OpenAI API Key。
4. 点击 `🧠✨ AI 理解函数`。
5. 每个真实语义节点都会执行：

```text
跨文件 / 跳到代码
        ↓
高亮真实语义节点
        ↓
角色显示 AI 教学气泡
        ↓
系统语音朗读
        ↓
朗读结束
        ↓
再进入下一节点
```

## 语音与 API Key 的关系

```text
🤖 老师跳到光标        → 不需要 API Key
🧭 项目文本导航        → 不需要 API Key
🧠 Dart 语义调用       → 不需要 API Key
🔊 把已有台词读出来    → 不需要 API Key

✨ AI 老师理解项目      → 需要 API Key
🧠✨ AI 理解函数       → 需要 API Key
```

AI 负责“讲什么”，系统 TTS 负责“把已经生成的文字说出来”。

## 当前调用链

```text
Dart Analysis Server / 项目搜索
        ↓
AI（需要时）规划教学路线
        ↓
TutorMove[]
        ↓
CharacterController.moveTo()
        ↓
切文件 + 滚动 + 高亮 + 跳跃
        ↓
VoiceController.speak(move.speech)
        ↓
Windows 系统语音
        ↓
说完后继续下一个 TutorMove
```

## 当前限制

- 完整语义语言目前仍以 Dart / Flutter 为主。
- 当前语音使用系统 TTS，声音自然度取决于操作系统安装的语音。
- 尚未接 OpenAI TTS / ElevenLabs 等高质量云端语音。
- 尚未做麦克风语音提问和“等等 / 继续 / 上一个”等语音控制。
- AI Key 当前只保存在 Electron 进程内存，关闭 IDE 后清除。

## 下一阶段

下一步可以继续做两条中的任意一条：

```text
A. 语音输入
“等等” / “继续” / 直接问代码问题

B. 更完整项目语义图
Call Hierarchy + Definition + References + Implementation + Type
```
