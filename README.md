# AI Code Tutor IDE — Alpha 0.3

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，并最终能够理解整个项目后自己决定下一跳。

## Alpha 0.3

这一版第一次建立“项目级 Tutor 导航协议”：

1. 保留 Alpha 0.2 的真实项目文件树与 Monaco 编辑器
2. 新增项目全文检索 IPC：Renderer 不直接读取硬盘
3. 把 `TutorMove` 从 demo 代码抽离到 `src/core/tutor_move.ts`
4. `TutorMove` 现在成为角色统一动作协议：`filePath + line + column + action + speech`
5. 光标放在类名、方法名或变量名上，可以点击 `🧭 老师找相关代码`
6. IDE 会在整个真实项目里查找这个标识符的其他出现位置
7. 角色按搜索结果自动跨文件跳跃，并同步高亮真实代码
8. 尚未打开过的目标文件会按需读取，不需要提前把整个项目全部加载进 Monaco
9. 再次点击“停止寻找”可以中断当前项目导航

## 运行

```bash
npm install
npm run typecheck
npm run dev
```

测试方式：

1. `📂 打开项目`
2. 打开一个真实源码文件
3. 把光标放在一个有多处引用的类名 / 方法名 / 变量名上，例如 `MessageBubble`
4. 点击 `🧭 老师找相关代码`
5. 观察角色在同文件和不同文件之间移动

也可以先选中一个完整标识符，再点击按钮。

## 当前调用链

```text
光标 / 选区
    ↓
EditorController.getNavigationSeed()
    ↓
Electron IPC
    ↓
项目全文检索
    ↓
ProjectSearchMatch[]
    ↓
ProjectNavigator
    ↓
TutorMove[]
    ↓
CharacterController
    ↓
打开目标文件 + 高亮 + 角色跳跃 + 气泡
```

## 为什么这一版还没直接接 AI

Alpha 0.3 先把“AI 将来需要控制什么”固定下来。

未来 AI 不需要控制 Electron、Monaco 或动画 DOM，它只需要产生类似：

```ts
{
  filePath: 'lib/features/chat/chat_service.dart',
  line: 86,
  column: 5,
  action: 'point',
  speech: 'MessageBubble 的数据最终来自这里。'
}
```

IDE 自己负责打开文件、滚动、高亮和让角色跳过去。

当前的全文检索只是第一个 `TutorMove` 来源。后面可以继续增加：

- AI 项目理解
- LSP definition / references
- import / symbol 图
- Git diff
- diagnostics

这些来源最终都复用同一个角色移动协议。

## 安全边界

Renderer 继续保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

项目读取与搜索均在 Electron Main 中完成，只通过 preload 暴露明确的 IPC API。

## 下一阶段

Alpha 0.4：**让 AI 真正生成 TutorMove 教学路线**。

目标：

```text
选中一段真实代码
        ↓
当前文件 + 附近上下文
        ↓
项目相关代码检索
        ↓
AI 理解功能链
        ↓
TutorMove[]
        ↓
角色自己决定跨文件跳到哪里讲
```
