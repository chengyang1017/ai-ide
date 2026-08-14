# AI Code Tutor IDE — Alpha 0.4

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并最终能够理解整个项目后自己决定下一跳。

## Alpha 0.4

这一版第一次让 AI 真正参与“角色应该去哪里讲”：

1. 保留 Alpha 0.3 的真实项目文件树、Monaco 编辑器和跨文件角色移动
2. 新增 `✨ AI 老师理解项目`
3. 用户可以选中代码，或把光标放在类名 / 方法名 / 变量名上
4. IDE 先读取当前代码，再在真实项目中检索相关候选位置
5. 每个候选都会附带真实文件路径、行号和附近代码片段
6. OpenAI 只负责从这些真实候选中挑选 1～6 个值得学习的位置并排序
7. AI 返回 `candidateId + action + speech`，不能自行编造文件和行号
8. Electron Main 把 AI 结果映射回安全的 `TutorMove[]`
9. 角色随后自动跨文件跳转、高亮并讲解
10. API Key 只保存在当前 Electron 进程内；关闭 IDE 后即清除，也可以通过 `OPENAI_API_KEY` 环境变量提供

## 运行

```bash
npm install
npm run typecheck
npm run dev
```

测试方式：

1. `📂 打开项目`
2. 打开一个真实源码文件
3. 选中一段代码，或把光标放在一个标识符上，例如 `MessageBubble`
4. 点击 `✨ AI 老师理解项目`
5. 第一次使用会提示输入 OpenAI API Key
6. 观察角色按照 AI 规划的路线在同文件 / 跨文件之间移动

原来的：

```text
🧭 老师找相关代码
```

仍然保留，用来对比“机械全文搜索”和“AI 挑选教学路线”的差异。

## Alpha 0.4 调用链

```text
选区 / 光标
    ↓
EditorController.getTutorFocus()
    ↓
Electron IPC
    ↓
当前代码 + 项目全文检索
    ↓
真实候选位置 + 附近代码片段
    ↓
OpenAI Responses API
    ↓
Structured Outputs
    ↓
candidateId + action + speech
    ↓
Electron Main 映射到真实位置
    ↓
TutorMove[]
    ↓
CharacterController
    ↓
打开文件 + 滚动 + 高亮 + 角色跳跃 + 气泡讲解
```

## 为什么 AI 不能直接返回任意文件和行号

为了避免模型“说得像真的一样”却跳到不存在的位置，Alpha 0.4 不允许 AI 自由填写：

```text
filePath
line
column
```

IDE 先生成：

```text
current
candidate-1
candidate-2
...
```

每个 candidate 都已经绑定一个真实存在的代码位置。AI 只能选择 candidate ID。

因此：

```text
AI 负责理解和排序
IDE 负责事实和执行
```

## 当前限制

Alpha 0.4 已经是 AI 项目导航，但还不是完整的“项目语义理解”。

当前候选位置仍主要来自全文检索，所以：

- 能跨整个项目找同名代码
- AI 能过滤明显没用的同名位置
- AI 能基于附近代码判断哪些位置更值得讲
- 但还不能保证精确识别“定义 / 真正调用 / 引用 / override / 实现关系”

真正的语义关系下一步要接 LSP / Language Server。

## 安全边界

Renderer 继续保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

项目文件读取、项目搜索以及 OpenAI API 请求全部在 Electron Main 中完成。Renderer 不直接拥有 Node 文件系统权限，也不会直接持有持久化 API Key。

## 下一阶段

Alpha 0.5：**语义级代码导航（LSP / Language Server）**。

目标从：

```text
“项目里哪里出现了 MessageBubble”
```

升级到：

```text
MessageBubble 定义在哪里
谁真正实例化 / 调用了它
这个方法有哪些 references
import 来自哪里
实现 / override 在哪里
```

然后把这些语义结果继续交给 AI，最终生成更准确的 TutorMove 教学链。
