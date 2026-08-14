# AI Code Tutor IDE — Alpha 0.2

一个独立桌面代码编辑器原型。核心目标不是做“右侧 AI 聊天框”，而是让动画 AI 导师直接生活在代码区域里，可以站到真实代码旁边、跳到指定行，并最终由 AI 驱动跨文件教学。

## Alpha 0.2

这一版开始读取电脑里的真实项目：

1. Electron 原生“打开文件夹”对话框
2. 主进程安全读取项目目录，Renderer 不直接获得 Node.js / `fs` 权限
3. 自动跳过 `.git`、`node_modules`、`dist`、`build` 等大目录
4. 左侧 Explorer 根据真实目录生成文件树
5. 点击文件后按需读取源码并在 Monaco 中打开
6. 支持 TypeScript / JavaScript / Dart / Python / Java / Kotlin / JSON / CSS / HTML / Markdown 等常见文本代码文件
7. 点击代码中的任意位置，再点“老师跳到光标”，角色会真正移动到真实代码对应坐标
8. Monaco 滚动后角色继续跟随目标代码位置

## 运行

```bash
npm install
npm run typecheck
npm run dev
```

启动后：

1. 点击 `📂 打开项目`
2. 选择一个真实项目目录
3. 在左侧 Explorer 打开源码文件
4. 把光标放到任意代码位置
5. 点击 `🤖 老师跳到光标`

## 架构

```text
Electron Main
  ├─ Native folder dialog
  ├─ Project file discovery
  └─ Safe file reading
          ↓ IPC
Electron Preload
          ↓ contextBridge
Renderer
  ├─ Explorer
  ├─ Monaco Editor
  └─ Character Overlay
```

Renderer 保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

文件系统能力只通过明确的 preload API 暴露。

## 当前还没做

- 保存真实文件
- 新建 / 删除 / 重命名文件
- Terminal
- Git
- LSP
- AI 项目理解
- AI 自动决定角色下一跳
- 跨文件 AI 教学路线

## 下一阶段

Alpha 0.3：**项目上下文与 AI 导航协议**。

目标不是把整个项目一次性塞给 AI，而是开始建立：

```text
当前文件 / 光标 / 选区
        ↓
项目文件索引
        ↓
相关代码检索
        ↓
Tutor Move
        ↓
角色自动跳到真正相关的代码
```
