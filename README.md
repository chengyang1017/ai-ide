# AI Code Tutor IDE — Alpha 0.7

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并能够沿真实项目调用链跨文件跳着讲。


## Alpha 0.7 新增

1. `AI 理解函数` 不再要求精准点中函数名：支持选中整个 Dart 函数、只选函数名、或把光标放在函数体内部。
2. Electron 把 Selection 范围传给 Dart LSP，通过 `textDocument/documentSymbol` 自动找到最近的 Function / Method / Constructor，再从真实符号位置启动 Call Hierarchy。
3. 修复选中 `Future<void> foo() { ... }` 时误把 `Future` 当成语义根节点的问题。
4. 左侧项目文件夹默认全部折叠，避免大型项目打开后整棵目录树铺满。
5. 用户手动展开的目录保持展开；角色 / AI 跨文件导航时只自动展开目标文件的祖先目录并滚动到当前文件。

## Alpha 0.6

这一版把 Alpha 0.4 的 AI 教学规划与 Alpha 0.5 的 Dart LSP 真实语义调用合并：

1. 新增 `🧠✨ AI 理解函数`
2. 新增三种教学方向：
   - `完整功能链`
   - `谁调用它`
   - `它调用谁`
3. Dart Analysis Server 先通过 Call Hierarchy 建立真实调用图
4. `完整功能链` 默认探索 2 层；单方向最多探索 3 层
5. Flutter SDK / 第三方包等项目外节点默认过滤，不让老师轻易跑出用户项目
6. IDE 读取每个真实语义节点附近的代码，再交给 AI 排教学顺序
7. AI 只能选择 LSP 已经返回的真实节点 ID，不能自己编造文件或行号
8. AI 最终生成 `TutorMove[]`，角色按顺序切文件、滚动、高亮、跳跃并讲解
9. Alpha 0.5 的机械 `🧠 Dart 语义调用` 仍然保留，方便和 AI 教学路线直接比较

## 运行

```bash
npm run typecheck
npm run dev
```

Alpha 0.6 没有新增 npm 依赖，所以不需要重新 `npm install`。

Dart 语义分析依赖本机 Dart SDK：

```bash
dart --version
```

Windows 下 IDE 会自动从 `DART_BIN`、`FLUTTER_ROOT`、`where.exe dart` 与 PATH 中寻找 Flutter SDK 内真正可直接启动的 `dart.exe`。

## 测试方式

建议打开 Flutter 项目：

1. `📂 打开项目`
2. 打开 `.dart` 文件
3. 把光标准确放在一个函数或方法名称上
4. 如果尚未设置，先点 `🔑 API Key`
5. 选择 `完整功能链 / 谁调用它 / 它调用谁`
6. 点击 `🧠✨ AI 理解函数`

例如光标位于：

```dart
Future<void> _loadSavedAccounts() async {
```

理想链路：

```text
Dart Analysis Server
        ↓
真实 incoming / outgoing Call Hierarchy
        ↓
项目内 2～3 层调用图
        ↓
读取每个节点附近真实代码
        ↓
AI 判断哪些节点最值得教学
        ↓
TutorMove[]
        ↓
角色：入口 → 当前函数 → 关键下游调用
```

## Alpha 0.3 ～ 0.6 的区别

```text
Alpha 0.3
全文文本搜索
“哪里出现了这个名字？”

Alpha 0.4
全文搜索候选 + AI
“这些同名位置里，哪些值得教？”

Alpha 0.5
Dart Analysis Server / LSP
“这个函数真正被谁调用？它真正调用谁？”

Alpha 0.6
LSP 真实调用图 + AI
“沿真实调用关系，哪条路线最适合把这个功能讲明白？”
```

## Alpha 0.6 调用链

```text
Monaco 光标
    ↓
EditorController.getSemanticFocus()
    ↓
Electron IPC
    ↓
DartLspClient.findCallGraph()
    ↓
dart language-server --protocol=lsp
    ↓
递归 incomingCalls / outgoingCalls
    ↓
只保留当前项目内部节点
    ↓
读取节点附近代码
    ↓
OpenAI 规划教学顺序
    ↓
受限 candidateId Structured Output
    ↓
TutorMove[]
    ↓
CharacterController
    ↓
跨文件跳跃 + 高亮 + 讲解
```

## 当前限制

- 第一种完整语义语言仍然只有 Dart / Flutter
- Call Hierarchy 默认只探索有限深度，避免角色钻进巨大调用图
- 项目外 SDK / package 默认不展开
- AI Key 当前只保存在 Electron 进程内存，关闭 IDE 后清除
- 尚未做真正的调用图可视化
- 尚未把数据流、类型关系、override / implementation 合并成统一项目知识图

## 安全边界

Renderer 继续保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

项目文件读取、Dart LSP 子进程和 OpenAI 请求都由 Electron Main 负责，Renderer 只通过 preload 的有限 IPC 使用这些能力。

## 下一阶段

Alpha 0.7 可以开始把“调用链”升级成更完整的项目语义图：

```text
Call Hierarchy
+
Definition / References
+
Type / Implementation
+
数据流候选
        ↓
统一 Project Semantic Graph
        ↓
AI 导师真正带用户理解一个完整功能
```
