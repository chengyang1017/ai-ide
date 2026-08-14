# AI Code Tutor IDE — Alpha 0.5

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并最终能够理解整个项目后自己决定下一跳。

## Alpha 0.5

这一版第一次接入真正的 **Language Server Protocol（LSP）语义导航**。第一种语言先做 Dart / Flutter：

1. 新增 `🧠 Dart 语义调用`
2. Electron Main 会启动本机的 `dart language-server --protocol=lsp`
3. 当前 Dart 文件通过 `textDocument/didOpen / didChange` 同步给 Dart Analysis Server
4. 光标位于函数 / 方法时，优先请求 Call Hierarchy：
   - `textDocument/prepareCallHierarchy`
   - `callHierarchy/incomingCalls`
   - `callHierarchy/outgoingCalls`
5. 角色先跳到当前符号的定义，再跳到真正调用它的位置，以及它真正调用出去的目标
6. 如果当前符号不适用 Call Hierarchy（例如类名 / 字段 / 普通变量），自动退回：
   - `textDocument/definition`
   - `textDocument/references`
7. LSP 返回的绝对文件路径会再次限制在当前已打开项目内部，然后转换成 `TutorMove[]`
8. 原来的全文搜索和 AI 路线仍然保留，可以直接比较“文本同名”与“语言语义”的差别

## 运行

```bash
npm run typecheck
npm run dev
```

Alpha 0.5 没有新增 npm 依赖，所以如果 Alpha 0.4 已经跑过，不需要重新 `npm install`。

Dart 语义导航依赖本机 Dart SDK。先确认终端里这个命令可用：

```bash
dart --version
```

Flutter SDK 自带 Dart SDK，因此正常 Flutter 开发环境通常已经具备它。

## 测试方式

建议直接打开一个 Flutter 项目：

1. `📂 打开项目`
2. 打开任意 `.dart` 文件
3. 把光标放在一个自己项目里的方法名上，例如 `watchPosts`、`build`、`createPost` 等
4. 点击 `🧠 Dart 语义调用`
5. 第一次点击会启动 Dart Analysis Server，可能比后续点击稍慢
6. 观察角色跨文件跳转

如果这个符号支持 Call Hierarchy，路线大致是：

```text
当前方法
    ↓
方法定义
    ↓
谁真正调用它（incomingCalls）
    ↓
它又真正调用谁（outgoingCalls）
```

如果是类 / 字段等不适合 Call Hierarchy 的符号，则变成：

```text
当前符号
    ↓
真实定义
    ↓
真实 references
```

## Alpha 0.3 / 0.4 / 0.5 的区别

```text
Alpha 0.3
全文文本搜索
“哪里出现了这个名字？”

Alpha 0.4
全文搜索候选 + AI
“这些同名位置里，哪些值得教？”

Alpha 0.5
Dart Analysis Server / LSP
“这个符号真正定义在哪里？谁调用它？它调用谁？”
```

这也是为什么 Alpha 0.5 不再只是看字符串是否相同。

## Alpha 0.5 调用链

```text
Monaco 光标
    ↓
EditorController.getSemanticFocus()
    ↓
Electron IPC
    ↓
DartLspClient
    ↓
dart language-server --protocol=lsp
    ↓
Call Hierarchy / Definition / References
    ↓
项目内真实语义位置
    ↓
SemanticNavigator
    ↓
TutorMove[]
    ↓
CharacterController
    ↓
切文件 + 滚动 + 高亮 + 角色跳跃
```

## 当前限制

Alpha 0.5 的 LSP 层先只接 Dart，这是为了先把完整语义链跑通，而不是一次接十几种语言。

当前还没有：

- TypeScript / JavaScript Language Server
- Python Language Server
- Java / Kotlin Language Server
- 持久化 Language Server 管理器
- 把 LSP 的精确语义结果再交给 AI 排教学顺序
- 深层递归调用图

当前的 Call Hierarchy 是“当前符号的一层 incoming / outgoing”。下一阶段再让角色沿调用关系继续递归探索。

## 安全边界

Renderer 继续保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

项目文件读取、LSP 子进程以及 OpenAI API 请求都由 Electron Main 负责。Renderer 只能通过 preload 暴露的有限 IPC 接口调用这些能力。

## 下一阶段

Alpha 0.6：**AI + LSP 合并**。

不再让 AI 从全文搜索候选里猜，而是：

```text
LSP 给出真实定义 / 调用 / 引用
        ↓
AI 阅读这些真实语义节点附近的代码
        ↓
AI 决定教学顺序
        ↓
角色沿真实功能链跳
```

这样角色的路线会同时具备：

```text
LSP 的准确
+
AI 的理解和讲解
```
