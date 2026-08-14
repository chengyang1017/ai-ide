# AI Code Tutor IDE — Alpha 0.1

这是一个**全新的独立项目**，不是原来的 VS Code Extension 子目录。

第一阶段只验证一个核心产品形态：

> 动画 AI 导师直接生活在代码编辑区里，可以跳到指定代码行、指着代码、跟随滚动，并跨文件移动。

## 技术栈

- Electron：桌面应用外壳
- Monaco Editor：代码编辑器
- TypeScript
- Vite

## 当前能力

- 独立桌面窗口
- Monaco 可编辑代码
- 左侧示例文件树
- 多文件模型切换
- Tutor 角色作为 Monaco 上方的独立覆盖层
- 使用 Monaco 可视坐标把 `line + column` 转换成角色屏幕位置
- 编辑器滚动时角色跟随代码位置
- 角色跳跃动画
- 当前讲解行高亮
- 气泡跟角色一起移动
- 跨文件跳跃演示

当前还**没有**：真实磁盘文件系统、Terminal、LSP、AI API、项目索引。这些会在核心交互验证成功后逐层加入。

## 运行

```bash
npm install
npm run typecheck
npm run dev
```

Electron 窗口打开以后，点击：

```text
▶ 让老师开始跳
```

也可以用“下一跳”逐步观察角色如何定位代码。

## 当前架构

```text
ai-code-tutor-ide/
├─ electron/
│  └─ main.cjs
├─ src/
│  ├─ character/
│  │  └─ character_controller.ts
│  ├─ demo/
│  │  └─ demo_project.ts
│  ├─ editor/
│  │  ├─ editor_controller.ts
│  │  └─ monaco_setup.ts
│  ├─ main.ts
│  └─ styles.css
├─ index.html
├─ package.json
└─ tsconfig.json
```

核心关系：

```text
TutorMove
  filePath
  line
  column
  action
  speech
      ↓
CharacterController
      ↓
EditorController
      ↓
Monaco getScrolledVisiblePosition()
      ↓
屏幕 x / y
      ↓
角色跳到代码位置
```

未来 AI 只需要生成类似这样的指令：

```ts
{
  filePath: "src/require_admin.ts",
  line: 10,
  column: 3,
  action: "point",
  speech: "如果 Authorization 不是 Bearer Token，请求就在这里被挡住。"
}
```

角色系统不关心这条指令来自 OpenAI、本地模型还是其他 Tutor Core。
