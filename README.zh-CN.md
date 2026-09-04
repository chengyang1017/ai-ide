# Code Tutor Studio

[English](README.md) | [简体中文](README.zh-CN.md)

一个独立的开发者学习环境，让动画 AI 导师可以**直接在真实项目代码中进行讲解**。

Code Tutor Studio 并不是传统的“右侧 AI 聊天框”式工具。它会跟随真实代码、跨文件移动，读取 Dart Analysis Server 返回的语义信息，并把项目结构转换成可交互的教学路径。

项目同时包含桌面 IDE、手机 / 平板代码阅读、持久代码便签、语音合成、语义导航和项目级学习工具。

---

## 截图

> 这里暂时保留截图占位。准备好图片后，将文件放到 `docs/screenshots/` 即可。

### 桌面 IDE

📸 **截图占位：** `docs/screenshots/desktop-ide.png`

### 编辑器中的 AI 导师

📸 **截图占位：** `docs/screenshots/ai-tutor.png`

### Dart 语义导航

📸 **截图占位：** `docs/screenshots/dart-navigation.png`

### 持久代码便签

📸 **截图占位：** `docs/screenshots/code-notes.png`

### 平板 / 手机代码阅读器

📸 **截图占位：** `docs/screenshots/tablet-reader.png`

### 外观 / 背景自定义

📸 **截图占位：** `docs/screenshots/appearance.png`

### 共享阅读会话

📸 **截图占位：** `docs/screenshots/shared-reader.png`

---

## 为什么做这个项目

大多数 AI 编程工具会把 AI 放在代码旁边。

Code Tutor Studio 尝试另一种交互方式：

```text
真实项目
   ↓
语义代码结构
   ↓
教学路径
   ↓
Tutor 跳到相关文件 / 代码行
   ↓
高亮 + 解释 + 朗读
```

目标是让代码讲解更像有人带着你沿着真实项目一步一步看，而不是让 AI 在另一个聊天窗口里单独回答问题。

---

## 核心功能

### 项目级代码编辑器

- 打开真实项目并浏览文件树
- 基于 Monaco Editor 的代码编辑
- 真正修改原始文件
- `Ctrl+S` 写回磁盘
- 未保存状态提示
- 自动恢复上次打开的项目和文件
- 面向桌面 IDE 的工作台布局

### 直接位于代码区的 AI Tutor

动画 Tutor 不固定住在单独的 AI 面板中，而是直接出现在代码区域附近。

它可以：

- 在教学目标之间移动
- 按 `TutorMove[]` 教学路径跨文件跳转
- 高亮相关代码
- 显示紧凑讲解文字
- 朗读当前讲解
- 尽量避开代码字符，不挡住正在解释的内容

### Dart 语义导航

项目接入 **Dart Analysis Server**，获得真实项目级语义信息。

当前主要能力包括：

- Definition 跳转
- References
- Document Symbols
- Call Hierarchy
- Function / Method / Constructor 定位
- `Ctrl+Click` 语义跳转

一个典型教学流程可以理解为：

```text
选中 Dart 函数
      ↓
Dart Analysis Server
      ↓
真实语义节点
      ↓
AI 组织教学顺序
      ↓
Tutor 跨文件移动
```

AI 不应该随意猜测代码位置，而是先让 LSP / Analysis Server 提供真实节点，再让 AI 决定如何组织讲解。

### 持久代码便签

Code Tutor Studio 可以把学习笔记绑定到代码位置，同时**不修改源码本身**。

便签可以显示在：

- 代码旁
- 行号 / gutter 附近

项目级便签可保存在：

```text
.ai-code-tutor/
├── notes.json
└── assets/
```

这样便签可以和项目一起提交 Git，让其他人打开同一个项目时看到相同的学习记录。

便签系统还支持：

- 持久文本便签
- 图片附件
- 粘贴截图
- 拖放图片
- 使用 `anchorText` 在代码发生轻微位移后重新定位
- 从旧版本地便签存储自动迁移

### Tutor 语音

在 Windows 上，应用可以通过 Electron 调用原生语音合成。

```text
TutorMove.speech
      ↓
Voice Controller
      ↓ IPC
Electron Main
      ↓
Windows.Media.SpeechSynthesis
      ↓
音频播放
      ↓
Tutor 说话动画
```

可以保存的语音偏好包括：

- 是否启用语音
- 语言
- 具体 Voice
- 语速

### API Key 安全保存

桌面端可以通过 Electron `safeStorage` 保存 OpenAI API Key。

在 Windows 中，底层依赖当前用户的 DPAPI 保护，而不是把 Key 直接明文写进文件。

```text
API Key
   ↓
Electron safeStorage
   ↓
Windows DPAPI
   ↓
加密后的本地状态
```

### 平板 / 手机阅读模式

仓库中还包含 Android / Capacitor 和平板专用代码路径，用来探索小屏幕上的代码学习体验。

这里的目标不是把桌面 IDE 直接缩小，而是针对小屏幕重新设计代码阅读与导航方式。

当前探索包括：

- 平板专用布局
- 手机 Reader Session
- 响应式代码显示
- 阅读优先控制方式

### 共享 Reader Session

项目包含轻量的 reader-room server 和 WebSocket 支持，用于多人 / 多设备共享阅读会话。

这让项目不再只是单机代码编辑器，也为后续协作学习提供基础。

---

## 架构

高层结构可以理解为：

```text
┌──────────────────────────────┐
│ Vite + TypeScript Renderer   │
│ Monaco Editor                │
└──────────────┬───────────────┘
               │
               │ IPC
               ▼
┌──────────────────────────────┐
│ Electron Main Process        │
│ 文件系统 / safeStorage      │
│ Windows 原生 TTS             │
└──────────────┬───────────────┘
               │
               ├───────────────► Dart Analysis Server
               │
               └───────────────► 本地项目文件

可选 Reader / 分享路径：

Android / Capacitor
        │
        ▼
Reader workflow
        │
        ▼
WebSocket reader-room server
```

---

## 项目结构

当前仓库已经把桌面端、编辑器、Reader、平板、便签、项目状态和 Tutor Character 拆成独立区域。

```text
code-tutor-studio/
├── android/
├── electron/
├── server/
├── src/
│   ├── android/
│   ├── character/
│   ├── core/
│   ├── demo/
│   ├── desktop/
│   ├── editor/
│   ├── memorize/
│   ├── notes/
│   ├── project/
│   ├── reader/
│   └── tablet/
├── capacitor.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术栈

### 桌面端

- Electron
- TypeScript
- Vite
- Monaco Editor

### 代码智能 / 语义分析

- Dart Analysis Server
- Definition / References / Call Hierarchy
- 项目级语义导航

### 手机 / 平板

- Capacitor
- Android
- 响应式 Reader UI

### 通信 / 数据

- WebSocket (`ws`)
- PostgreSQL Client (`pg`)

### 桌面系统集成

- Electron IPC
- 文件系统访问
- `safeStorage`
- Windows 原生语音合成

---

## 开发

安装依赖：

```bash
npm install
```

TypeScript 类型检查：

```bash
npm run typecheck
```

运行桌面开发环境：

```bash
npm run dev
```

构建 Renderer：

```bash
npm run build
```

打包 Windows 安装程序：

```bash
npm run package:win
```

启动 Reader Room Server：

```bash
npm run reader:server
```

Dart 语义功能要求本机可以使用 Dart SDK：

```bash
dart --version
```

---

## 当前能力

```text
真实项目文件树
+ Monaco 代码编辑器
+ Ctrl+S 真正写回文件
+ Dart Definition / References / Call Hierarchy
+ Ctrl+Click 语义跳转
+ AI 组织真实语义教学路线
+ Tutor 跨文件移动
+ Windows 原生 TTS
+ 项目级持久代码便签
+ 便签图片附件
+ 项目 / 文件会话恢复
+ 平板 / Android Reader 实验
+ Shared Reader Session 基础
```

---

## 当前限制

- 完整语义能力目前仍以 Dart / Flutter 项目最强。
- 当前定位仍然是实验型开发者学习环境，不是完整替代 VS Code 或 Android Studio。
- 完整 Debugger、集成终端、Git UI、外部文件冲突处理等高级 IDE 功能仍未完全实现。
- Windows 原生语音取决于系统实际暴露给应用的 Voice。
- 手机和平板工作流仍然在独立演进，不会简单复制桌面 IDE。

---

## 设计方向

Code Tutor Studio 的核心想法只有一句：

> **代码学习应该尽可能发生在真正被解释的代码附近。**

项目希望把：

```text
Code
+
Semantic Structure
+
AI Explanation
+
Navigation
+
Voice
+
Persistent Notes
```

组合成一个统一的开发者学习环境。

---

## 状态

**持续开发中。**

当前已经包含 Electron 桌面 IDE、Monaco 编辑器、Dart 语义导航、动画 Tutor 教学路线、持久代码便签、Windows 原生语音、Android / 平板 Reader，以及共享阅读会话基础设施。
