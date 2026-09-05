type LocalizedAttribute = 'title' | 'placeholder';

const CJK_RE = /[\u3400-\u9fff]/;

const exactTranslations = new Map<string, string>([
  ['等待打开项目', 'Waiting for project'],
  ['尚未打开真实项目', 'No local project open'],
  ['语音：等待讲解', 'Voice: waiting'],
  ['等待讲解', 'Waiting for explanation'],
  ['等待下一段', 'Waiting for next segment'],
  ['语音已关闭', 'Voice off'],
  ['等待任务', 'Waiting for task'],
  ['运行中', 'Running'],
  ['正在停止…', 'Stopping…'],
  ['关闭 Agent', 'Close Agent'],
  ['当前文件', 'Current file'],
  ['让 Agent 直接处理项目', 'Let Agent work on the project'],
  ['它可以读取、搜索、修改文件，并运行 typecheck / analyze / test 等验证命令。', 'It can read, search, and modify files, then run typecheck / analyze / test validation.'],
  ['例如：检查这个 Flutter 项目的登录流程，把 Provider 改成 BLoC，并运行 flutter analyze。', 'Example: inspect this Flutter login flow, migrate Provider to BLoC, then run flutter analyze.'],
  ['修改前会自动备份现有文件', 'Existing files are backed up before changes'],
  ['停止', 'Stop'],
  ['执行 Agent', 'Run Agent'],
  ['请先打开一个本地真实项目。', 'Open a local project first.'],
  ['请先打开一个本地真实项目', 'Open a local project first'],
  ['当前文件还有未保存修改，请先 Ctrl+S，再让 Agent 改项目。', 'The current file has unsaved changes. Press Ctrl+S before running Agent.'],
  ['还没有 OpenAI API Key，请先点击顶部 Key 设置。', 'No OpenAI API Key is configured. Set it from the Key button first.'],
  ['Agent 正在处理项目…', 'Agent is working on the project…'],
  ['⌨ 终端', '⌨ Terminal'],
  ['切换终端 · Ctrl+`', 'Toggle terminal · Ctrl+`'],
  ['清空终端输出', 'Clear terminal output'],
  ['清空', 'Clear'],
  ['重启终端会话', 'Restart terminal session'],
  ['重启', 'Restart'],
  ['隐藏终端', 'Hide terminal'],
  ['终端命令', 'Terminal command'],
  ['输入命令后按 Enter', 'Type a command and press Enter'],
  ['调整终端高度', 'Resize terminal height'],
  ['上下拖动调整终端高度 · 双击恢复默认', 'Drag vertically to resize · double-click to reset'],
  ['＋ 新建文件', '＋ New File'],
  ['＋ 新建文件夹', '＋ New Folder'],
  ['删除文件', 'Delete File'],
  ['删除文件夹', 'Delete Folder'],
  ['＋ 文件', '＋ File'],
  ['＋ 文件夹', '＋ Folder'],
  ['在当前选中的文件夹中新增文件', 'Create a file in the selected folder'],
  ['在当前选中的文件夹中新增文件夹', 'Create a folder in the selected folder'],
  ['新文件名称', 'New file name'],
  ['新文件夹名称', 'New folder name'],
  ['文件已经在这个文件夹里', 'The item is already in this folder'],
  ['请先打开一个真实项目。', 'Open a real project first.'],
  ['请先打开一个真实项目', 'Open a real project first'],
  ['这个操作会影响当前未保存的文件。请先按 Ctrl+S 保存，再继续。', 'This action affects an unsaved file. Press Ctrl+S to save before continuing.'],
  ['名称无效。不能使用路径分隔符、Windows 保留字符、保留设备名，也不能以空格或句点结尾。', 'Invalid name. Do not use path separators, Windows reserved characters or device names, or end with a space or period.'],
  ['新建文件', 'New File'],
  ['新建文件夹', 'New Folder'],
  ['项目根目录', 'Project root'],
  ['取消', 'Cancel'],
  ['创建', 'Create'],
  ['名称无效，请不要使用路径分隔符、Windows 保留字符或保留设备名。', 'Invalid name. Do not use path separators, Windows reserved characters, or reserved device names.'],
  ['项目刷新失败，请重新打开项目。', 'Project refresh failed. Reopen the project.'],
  ['✕ 文件管理桥接未就绪', '✕ File manager bridge is not ready'],
  ['👥 协作', '👥 Collaborate'],
  ['👥 好友协作', '👥 Friend Collaboration'],
  ['打开项目后，直接邀请好友一起阅读', 'Open a project, then invite a friend to read together'],
  ['账号用户名', 'Account username'],
  ['密码', 'Password'],
  ['至少 8 个字符', 'At least 8 characters'],
  ['登录', 'Sign In'],
  ['注册', 'Register'],
  ['退出账号', 'Sign Out'],
  ['正在连接好友服务…', 'Connecting to friend service…'],
  ['添加好友', 'Add Friend'],
  ['输入对方用户名', "Enter your friend's username"],
  ['发送请求', 'Send Request'],
  ['好友请求', 'Friend Requests'],
  ['好友', 'Friends'],
  ['当前协作', 'Current Collaboration'],
  ['已连接', 'Connected'],
  ['离开协作', 'Leave Collaboration'],
  ['准备就绪', 'Ready'],
  ['选择一个在线好友，点击“一起阅读”。', 'Choose an online friend and click “Read Together”.'],
  ['高级 / 兼容房间码', 'Advanced / Compatible Room Code'],
  ['房间服务器', 'Room Server'],
  ['创建兼容房间', 'Create Compatible Room'],
  ['房间码', 'Room code'],
  ['加入', 'Join'],
  ['好友协作默认不会上传源码正文；只有当你在默写页主动点击“开始共享”时，才会临时转发你正在输入的默写文本。原答案不会上传，房间结束后共享状态即清除。', 'Friend collaboration does not upload source code by default. Memorization text is relayed only when you explicitly start sharing; the original answer is never uploaded, and sharing ends with the room.'],
  ['跳过去', 'Jump There'],
  ['拒绝', 'Decline'],
  ['这是对方主动共享的默写输入，不包含原答案。', 'This is memorization input the other person chose to share. It does not include the original answer.'],
  ['请先打开一个项目', 'Open a project first'],
  ['服务器地址无效', 'Invalid server address'],
  ['请在高级设置里填写 ws:// 或 wss:// 地址。', 'Enter a ws:// or wss:// address in Advanced settings.'],
  ['想添加你为好友', 'Wants to add you as a friend'],
  ['接受', 'Accept'],
  ['已添加好友', 'Friend added'],
  ['好友当前离线', 'Friend is offline'],
  ['请先打开项目', 'Open a project first'],
  ['邀请好友前，请先打开 GitHub 仓库或 Android 本地项目。', 'Open a GitHub repository or Android local project before inviting a friend.'],
  ['邀请已发送', 'Invite sent'],
  ['正在建立协作', 'Starting collaboration'],
  ['还没有好友。输入用户名发送好友请求。', 'No friends yet. Enter a username to send a friend request.'],
  ['在线', 'Online'],
  ['离线', 'Offline'],
  ['邀请加入', 'Invite'],
  ['一起阅读', 'Read Together'],
  ['请先登录账号', 'Sign in first'],
  ['登录后才能添加好友和发送协作邀请。', 'Sign in to add friends and send collaboration invites.'],
  ['好友服务未就绪', 'Friend service is not ready'],
  ['正在验证协作协议版本，请稍后再试。', 'Verifying the collaboration protocol. Try again shortly.'],
  ['正在重新连接，请稍后再试。', 'Reconnecting. Try again shortly.'],
  ['用户名太短', 'Username is too short'],
  ['用户名至少需要 2 个字符。', 'Username must be at least 2 characters.'],
  ['密码太短', 'Password is too short'],
  ['密码至少需要 8 个字符。', 'Password must be at least 8 characters.'],
  ['正在连接账号服务', 'Connecting to account service'],
  ['连接完成后会自动继续。', 'This will continue automatically once connected.'],
  ['好友服务连接失败', 'Friend service connection failed'],
  ['协议不兼容', 'Protocol incompatible'],
  ['协作服务器版本不兼容', 'Collaboration server version is incompatible'],
  ['正在验证协作协议…', 'Verifying collaboration protocol…'],
  ['正在登录账号…', 'Signing in…'],
  ['正在恢复账号…', 'Restoring account…'],
  ['账号已登录', 'Signed in'],
  ['收到好友请求', 'Friend request received'],
  ['文件', 'Files'],
  ['保存', 'Save'],
  ['项目', 'Project'],
  ['更多', 'More'],
  ['GitHub 工作区', 'GitHub Workspace'],
  ['登录 GitHub', 'Sign in to GitHub'],
  ['登录后查看私有仓库、协作项目和关注的人', 'Sign in to view private repositories, collaboration projects, and people you follow'],
  ['使用 GitHub Device Flow 登录。Token 会加密保存在 Android Keystore。', 'Sign in with GitHub Device Flow. The token is encrypted in Android Keystore.'],
  ['加入好友协作后可共享', 'Share after joining a friend collaboration'],
  ['未共享 · 点击后好友才能看到', 'Not shared · click to let friends see it'],
  ['跨文件跳跃', 'Switching files'],
  ['正在指代码', 'Pointing at code'],
  ['正在思考', 'Thinking'],
  ['跳到目标', 'Jumping to target'],
  ['讲解已暂停 · 正在回答你的问题', 'Explanation paused · answering your question'],
  ['回答问题中', 'Answering question'],
  ['继续刚才的讲解', 'Resuming explanation'],
  ['讲解已打断', 'Explanation interrupted'],
  ['等待操作', 'Waiting for action'],
  ['📝 空便签已收起。', '📝 Empty note closed.'],
  ['当前 Electron 环境不支持系统语音', 'System voice is not supported in this Electron environment'],
  ['正在朗读', 'Speaking'],
  ['语音已暂停', 'Voice paused'],
  ['继续朗读', 'Resuming speech'],
  ['系统语音播放失败', 'System voice playback failed'],
  ['终端工作目录无效。', 'Invalid terminal working directory.'],
  ['终端工作目录不是文件夹。', 'Terminal working directory is not a folder.'],
  ['终端尚未启动。', 'Terminal has not started.'],
  ['终端输入无效。', 'Invalid terminal input.'],
  ['单次终端输入过长。', 'Terminal input is too long.'],
  ['当前项目不是可写的本地项目', 'The current project is not a writable local project.'],
  ['项目路径必须是字符串', 'Project path must be a string.'],
  ['不能直接操作项目根目录', 'The project root cannot be modified directly.'],
  ['路径必须位于当前项目内部', 'Path must stay inside the current project.'],
  ['目标不是文件夹', 'Target is not a folder.'],
  ['目标位置已经存在同名文件或文件夹', 'A file or folder with the same name already exists at the destination.'],
  ['不能把文件夹移动到它自己内部', 'A folder cannot be moved inside itself.'],
  ['机器人跟随代码', 'Robot follows code'],
  ['登录后查看你的项目和关注的人', 'Sign in to view your projects and people you follow'],
  ['我的项目', 'My Projects'],
  ['关注的人', 'Following'],
  ['搜索…', 'Search…'],
  ['退出登录', 'Sign Out'],
  ['没有匹配的项目', 'No matching projects'],
  ['没有找到项目', 'No projects found'],
  ['未知语言', 'Unknown language'],
  ['没有匹配的用户', 'No matching users'],
  ['你还没有关注任何用户', 'You are not following anyone yet'],
  ['查看这个用户的公开仓库', 'View this user\'s public repositories'],
  ['正在读取公开仓库…', 'Loading public repositories…'],
  ['读取失败', 'Failed to load'],
  ['正在读取 GitHub…', 'Loading GitHub…'],
  ['GitHub 读取失败', 'Failed to load GitHub'],
  ['✓ 登录成功，正在读取项目…', '✓ Signed in. Loading projects…'],
  ['在 GitHub 授权页输入下面的验证码：', 'Enter this code on the GitHub authorization page:'],
  ['打开 GitHub 授权', 'Open GitHub Authorization'],
  ['我已授权，继续登录', 'I\'ve authorized, continue'],
  ['切到 GitHub 完成授权后再回来即可；这个验证码会保留，不需要重新获取。', 'Complete authorization on GitHub, then return here. This code will stay available.'],
  ['GitHub 还没有确认授权。完成授权后回来再点一次即可。', 'GitHub has not confirmed authorization yet. Finish it and try again.'],
  ['GitHub 要求稍等几秒，再检查一次即可。', 'GitHub asked us to wait a few seconds. Try again shortly.'],
  ['检查 GitHub 登录状态失败', 'Failed to check GitHub sign-in status'],
  ['验证码已过期，请重新登录。', 'The code expired. Start sign-in again.'],
  ['正在向 GitHub 申请登录验证码…', 'Requesting a GitHub sign-in code…'],
  ['GitHub 登录失败', 'GitHub sign-in failed'],
  ['🐙 打开 GitHub 仓库', '🐙 Open GitHub Repository'],
  ['粘贴公开 GitHub 仓库或文件链接', 'Paste a public GitHub repository or file URL'],
  ['打开仓库', 'Open Repository'],
  ['请输入 https://github.com/... 链接。', 'Enter a https://github.com/... URL.'],
  ['打开 GitHub 公开仓库', 'Open a public GitHub repository'],
  ['🐙 读取中…', '🐙 Loading…'],
  ['GitHub · 正在读取远程仓库…', 'GitHub · Loading remote repository…'],
  ['读取代码便签失败', 'Failed to load code notes'],
  ['📝 完整单词中间不能插入便签；请把光标移到空格、标点或单词边界。', '📝 A note cannot be inserted in the middle of a word. Move the cursor to whitespace, punctuation, or a word boundary.'],
  ['📝 便签内容已清空；未自动覆盖原便签，如要删除请使用“删除”。', '📝 The note was cleared but the original was not overwritten. Use Delete to remove it.'],
  ['便签至少需要文字或图片。', 'A note needs text or an image.'],
  ['保存中…', 'Saving…'],
  ['没有正在编辑的便签。', 'There is no note being edited.'],
  ['📝 已删除项目代码便签', '📝 Project code note deleted'],
  ['删除代码便签失败', 'Failed to delete code note'],
  ['这里只能插入图片。', 'Only images can be inserted here.'],
  ['导入中…', 'Importing…'],
  ['导入便签图片失败', 'Failed to import note image'],
  ['点击查看大图', 'Click to view full image'],
  ['从便签移除图片', 'Remove image from note'],
  ['行号便签', 'Gutter note'],
  ['点击在行号旁添加项目便签', 'Click to add a project note beside the line number'],
  ['代码便签', 'Code note'],
  ['协作', 'Collaborate'],
  ['请先打开真实项目。', 'Open a real project first.'],
  ['请先打开一个项目。', 'Open a project first.'],
  ['Dart Language Server 尚未启动。', 'Dart Language Server has not started.'],
  ['Windows 原生 TTS 只在 Windows 上可用。', 'Windows native TTS is only available on Windows.'],
  ['单次朗读内容过长，请拆成更短的教学步骤。', 'This speech segment is too long. Split it into shorter teaching steps.'],
  ['Agent 跟随只能用于本地真实项目。', 'Agent follow is only available for local projects.'],
  ['当前没有好友远程项目。', 'There is no active friend remote project.'],
  ['GitHub API 地址无效。', 'Invalid GitHub API address.'],
  ['请先在 IDE 里设置 OpenAI API Key。', 'Set an OpenAI API Key in the IDE first.'],
  ['系统安全存储当前不可用，无法读取 OpenAI API Key。', 'Secure system storage is unavailable, so the OpenAI API Key cannot be read.'],
  ['无法解密已保存的 OpenAI API Key，请重新设置 Key。', 'The saved OpenAI API Key could not be decrypted. Set the key again.'],
  ['只允许打开 http/https 外部链接。', 'Only http/https external links are allowed.'],
  ['delete_file 只允许删除文件，不允许删除目录。', 'delete_file can delete files only, not directories.'],
  ['✍ 默写', '✍ Memorize'],
  ['闭卷默写', 'Closed-book Recall'],
  ['原代码已隐藏。空格、换行和缩进不计错；文字、标识符和符号必须一致。', 'The original code is hidden. Spaces, line breaks, and indentation are ignored; text, identifiers, and symbols must match.'],
  ['实时纠错', 'Live correction'],
  ['从记忆里把刚才选中的代码写出来…', 'Recreate the selected code from memory…'],
  ['原代码', 'Original Code'],
  ['👥 开始共享', '👥 Start Sharing'],
  ['查看答案', 'Show Answer'],
  ['检查', 'Check'],
  ['隐藏答案', 'Hide Answer'],
  ['👥 停止共享', '👥 Stop Sharing'],
  ['共享中 · 好友正在实时看到你的输入', 'Sharing · friends can see your input live'],
  ['✅ 完全正确', '✅ Correct'],
  ['❌ 还不正确。继续修改后可以再次检查。', '❌ Not correct yet. Keep editing and check again.'],
  ['📖 阅读', '📖 Read'],
  ['✏ 编辑', '✏ Edit'],
  ['GitHub 在线仓库当前保持只读阅读模式', 'GitHub online repositories stay in read-only mode'],
  ['进入 Monaco 编辑模式', 'Enter Monaco edit mode'],
  ['📖 GitHub 阅读模式 · 无输入光标与软键盘', '📖 GitHub reading mode · no input cursor or soft keyboard'],
  ['📖 阅读模式 · 无输入光标与软键盘', '📖 Reading mode · no input cursor or soft keyboard'],
  ['✏ 编辑模式 · 点击代码后可以输入', '✏ Edit mode · click code to start typing'],
  ['仓库首页', 'Repository home'],
  ['GitHub 远程仓库已经关闭。', 'The GitHub remote repository is closed.'],
  ['这个 GitHub 仓库没有找到可阅读的文本代码文件。', 'No readable text code files were found in this GitHub repository.'],
  ['GitHub 已连接', 'GitHub Connected'],
  ['复制链接', 'Copy Link'],
  ['在 IDE 打开', 'Open in IDE'],
  ['读取仓库中…', 'Loading repository…'],
  ['GitHub 正在导入', 'Importing from GitHub'],
  ['正在读取仓库文件树。公开仓库不需要登录。', 'Loading the repository file tree. Public repositories do not require sign-in.'],
  ['GitHub 已在 IDE 打开', 'GitHub Opened in IDE'],
  ['重新载入', 'Reload'],
  ['GitHub 仓库读取失败', 'Failed to load GitHub repository'],
  ['GitHub 导入失败', 'GitHub import failed'],
  ['重试', 'Retry'],
  ['正在把这个 GitHub 仓库直接载入 IDE…', 'Loading this GitHub repository directly into the IDE…'],
  ['✓ 已复制', '✓ Copied'],
  ['AI 导师', 'AI Tutor'],
  ['更多工具', 'More Tools'],
  ['随时问老师…', 'Ask the AI tutor anytime…'],
]);

const skipSelector = [
  '#editor',
  '.monaco-editor',
  '#speech-bubble',
  '.markdown-preview',
  '.file-item',
  '.directory-item',
  '#active-file',
  '#project-name',
  '#project-root',
  '.code-note-textarea',
  '.agent-log-row[data-kind="user"]',
  '[data-memorize-watch-code]',
].join(',');

const textSources = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<LocalizedAttribute, string>>();
let installed = false;

function englishUi(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('en');
}

function preserveWhitespace(source: string, translated: string): string {
  const leading = source.match(/^\s*/)?.[0] ?? '';
  const trailing = source.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function translateKnown(value: string): string {
  const trimmed = value.trim();
  const exact = exactTranslations.get(trimmed);
  if (exact) {
    return preserveWhitespace(value, exact);
  }

  let result = value;
  const replacements: Array<[RegExp, string]> = [
    [/✓ Agent 完成 · 修改 (\d+) · 删除 (\d+)/g, '✓ Agent done · Changed $1 · Deleted $2'],
    [/✓ Agent 完成 · ([^\n]+)/g, '✓ Agent done · $1'],
    [/Agent 新建 · /g, 'Agent created · '],
    [/Agent 修改 · /g, 'Agent modified · '],
    [/Agent 删除 · /g, 'Agent deleted · '],
    [/备份：/g, 'Backup: '],
    [/\[terminal\] 请先打开一个本地真实项目。/g, '[terminal] Open a local project first.'],
    [/\[terminal\] 正在重启…/g, '[terminal] Restarting…'],
    [/\[terminal\] 会话已结束/g, '[terminal] Session ended'],
    [/✓ 已新建文件夹 · /g, '✓ Created folder · '],
    [/✓ 已新建文件 · /g, '✓ Created file · '],
    [/✓ 已删除 · /g, '✓ Deleted · '],
    [/✓ 已移动 · /g, '✓ Moved · '],
    [/正在新建文件夹 · /g, 'Creating folder · '],
    [/正在新建文件 · /g, 'Creating file · '],
    [/✓ 新建文件夹成功 · /g, '✓ Folder created · '],
    [/✓ 新建文件成功 · /g, '✓ File created · '],
    [/位置：/g, 'Location: '],
    [/确定删除文件夹“([^”]+)”吗？\n\n文件夹内的所有文件和子文件夹都会一起删除。/g, 'Delete folder “$1”?\n\nAll files and subfolders inside it will also be deleted.'],
    [/确定删除文件“([^”]+)”吗？/g, 'Delete file “$1”?'],
    [/正在等待 (.+?) 加入。/g, 'Waiting for $1 to join.'],
    [/(.+?) 上线后再邀请。/g, 'Invite $1 when they are online.'],
    [/准备邀请 (.+?)…/g, 'Preparing to invite $1…'],
    [/(\d+) 在线/g, '$1 online'],
    [/(\d+) 个/g, '$1'],
    [/好友服务已连接 · 协议 v(\d+) · 请登录/g, 'Friend service connected · Protocol v$1 · Sign in'],
    [/已登录 (.+?) · 协议 v(\d+)/g, 'Signed in as $1 · Protocol v$2'],
    [/(.+?) · 好友资料将从服务器同步。/g, '$1 · Friend data will sync from the server.'],
    [/(.+?) 想添加你为好友。/g, '$1 wants to add you as a friend.'],
    [/客户端协议 v(\d+) 没有收到服务器握手响应。服务器可能仍是旧版本，请更新或重启 reader:server。/g, 'Client protocol v$1 received no server handshake. The server may be outdated; update or restart reader:server.'],
    [/客户端协议 v(\d+)，服务器协议 v(\d+)。请更新客户端或服务器后重试。/g, 'Client protocol v$1, server protocol v$2. Update the client or server and try again.'],
    [/客户端协议 v(\d+) 与服务器协议 v(\d+) 不兼容。/g, 'Client protocol v$1 is incompatible with server protocol v$2.'],
    [/ · 正在默写第 (\d+) 行/g, ' · memorizing line $1'],
    [/ · 正在默写第 (\d+)–(\d+) 行/g, ' · memorizing lines $1–$2'],
    [/ · 第 (\d+) 行/g, ' · line $1'],
    [/ · 第 (\d+) 列/g, ' · col $1'],
    [/ · (\d+)–(\d+) 行/g, ' · lines $1–$2'],
    [/协作需要 (.+?)，但实际打开的是 (.+?)。/g, 'Collaboration requires $1, but $2 is open.'],
    [/正在连接 (.+?)…/g, 'Connecting to $1…'],
    [/无法连接 (.+?)。/g, 'Unable to connect to $1.'],
    [/已缓存 (\d+) 个文本文件；真实写入时机器人会跳到修改位置/g, 'Cached $1 text files; the robot will jump to real edits'],
    [/Agent 跟随：/g, 'Agent follow: '],
    [/🤖 正在重新定位机器人 · /g, '🤖 Repositioning robot · '],
    [/Agent 已修改 (.+?)，但代码页未能及时完成定位/g, 'Agent changed $1, but the editor could not finish navigating in time'],
    [/⚠ Agent 已修改 (.+?)，但机器人\/Monaco 删改展示未启动/g, '⚠ Agent changed $1, but the robot/Monaco diff presentation did not start'],
    [/🤖 Agent 正在展示修改 · /g, '🤖 Agent showing changes · '],
    [/更新 (.+)/g, 'Updated $1'],
    [/(.+?) · 公开项目/g, '$1 · Public repositories'],
    [/@(.+?) · GitHub 工作区/g, '@$1 · GitHub Workspace'],
    [/GitHub 登录失败：(.+)/g, 'GitHub sign-in failed: $1'],
    [/GitHub 打开失败 · /g, 'GitHub open failed · '],
    [/GitHub · 正在读取 (.+?)…/g, 'GitHub · Loading $1…'],
    [/L(\d+) · 行号旁/g, 'L$1 · Gutter'],
    [/L(\d+):C(\d+) · 代码中/g, 'L$1:C$2 · Inline'],
    [/项目便签保存在 \.ai-code-tutor\/notes\.json/g, 'Project notes are stored in .ai-code-tutor/notes.json'],
    [/📝 已保存项目便签 · /g, '📝 Project note saved · '],
    [/单个便签最多 (\d+) 张图片。/g, 'A note can contain at most $1 images.'],
    [/🖼 已加入 (\d+) 张项目便签图片/g, '🖼 Added $1 project-note images'],
    [/无法读取：/g, 'Unable to read: '],
    [/点击 \*\*＋\*\* 在 L(\d+):C(\d+) 添加项目便签/g, 'Click **＋** to add a project note at L$1:C$2'],
    [/角色还没有加载目标文件：/g, 'Tutor has not loaded the target file: '],
    [/Dart LSP 请求超时：/g, 'Dart LSP request timed out: '],
    [/GitHub 请求失败 · HTTP/g, 'GitHub request failed · HTTP'],
    [/⚠ 写错了 · 第 (\d+) 个有效字符/g, '⚠ Mismatch · effective character $1'],
    [/第 (\d+) 行/g, 'Line $1'],
    [/第 (\d+)–(\d+) 行 · (\d+) 行代码/g, 'Lines $1–$2 · $3 lines of code'],
    [/✍ (.+?) 正在默写/g, '✍ $1 is memorizing'],
    [/👥 已跳到共享阅读位置 · /g, '👥 Jumped to shared reading position · '],
    [/GitHub 仓库中没有这个代码文件：/g, 'This code file is not in the GitHub repository: '],
    [/GitHub 在线仓库目前是只读模式，不能直接保存 (.+?)。/g, 'GitHub online repositories are read-only; cannot save $1 directly.'],
    [/✓ GitHub · (.+?) · (.+?) · (\d+) 个代码文件 · 只读/g, '✓ GitHub · $1 · $2 · $3 code files · read-only'],
    [/(\d+) 个代码文件 · (.+?) · 当前为只读阅读模式。/g, '$1 code files · $2 · read-only reading mode.'],
    [/✓ GitHub · (.+?) · (\d+) 个代码文件/g, '✓ GitHub · $1 · $2 code files'],
  ];

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function shouldSkip(element: Element | null): boolean {
  return Boolean(element?.closest(skipSelector));
}

function localizeTextNode(node: Text): void {
  if (shouldSkip(node.parentElement)) {
    return;
  }

  const current = node.nodeValue ?? '';
  if (englishUi()) {
    const existingSource = textSources.get(node);
    if (CJK_RE.test(current)) {
      textSources.set(node, current);
    } else if (existingSource) {
      const expected = translateKnown(existingSource);
      if (current !== expected) {
        textSources.delete(node);
        return;
      }
    }

    const source = textSources.get(node) ?? current;
    const translated = translateKnown(source);
    if (translated !== current) {
      node.nodeValue = translated;
    }
    return;
  }

  const source = textSources.get(node);
  if (source && current !== source) {
    node.nodeValue = source;
  }
}

function localizeAttribute(element: Element, attribute: LocalizedAttribute): void {
  if (shouldSkip(element)) {
    return;
  }
  const current = element.getAttribute(attribute);
  if (!current) {
    return;
  }

  let sources = attributeSources.get(element);
  if (!sources) {
    sources = new Map();
    attributeSources.set(element, sources);
  }

  if (englishUi()) {
    const existingSource = sources.get(attribute);
    if (CJK_RE.test(current)) {
      sources.set(attribute, current);
    } else if (existingSource) {
      const expected = translateKnown(existingSource);
      if (current !== expected) {
        sources.delete(attribute);
        return;
      }
    }

    const source = sources.get(attribute) ?? current;
    const translated = translateKnown(source);
    if (translated !== current) {
      element.setAttribute(attribute, translated);
    }
    return;
  }

  const source = sources.get(attribute);
  if (source && current !== source) {
    element.setAttribute(attribute, source);
  }
}

function localizeSubtree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text);
    return;
  }

  if (!(root instanceof Element) && root !== document.body) {
    return;
  }

  if (root instanceof Element && shouldSkip(root)) {
    return;
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element && shouldSkip(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.nodeType === Node.TEXT_NODE && shouldSkip(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      localizeTextNode(node as Text);
    } else if (node instanceof Element) {
      localizeAttribute(node, 'title');
      localizeAttribute(node, 'placeholder');
    }
    node = walker.nextNode();
  }
}

function installDialogLocalization(): void {
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);

  window.alert = ((message?: unknown): void => {
    nativeAlert(englishUi() ? translateKnown(String(message ?? '')) : message);
  }) as typeof window.alert;

  window.confirm = ((message?: string): boolean =>
    nativeConfirm(englishUi() ? translateKnown(String(message ?? '')) : String(message ?? ''))
  ) as typeof window.confirm;

  window.prompt = ((message?: string, defaultValue?: string): string | null =>
    nativePrompt(
      englishUi() ? translateKnown(String(message ?? '')) : String(message ?? ''),
      defaultValue,
    )
  ) as typeof window.prompt;
}

function install(): void {
  if (installed) {
    return;
  }
  installed = true;
  installDialogLocalization();

  const observer = new MutationObserver((mutations) => {
    let languageChanged = false;
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes'
          && mutation.target === document.documentElement
          && mutation.attributeName === 'lang'
      ) {
        languageChanged = true;
        continue;
      }

      if (mutation.type === 'characterData') {
        localizeSubtree(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) {
        localizeSubtree(node);
      }
    }

    if (languageChanged && document.body) {
      localizeSubtree(document.body);
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['lang'],
  });

  if (document.body) {
    localizeSubtree(document.body);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      localizeSubtree(document.body);
    }, { once: true });
  }
}

install();

export { translateKnown };
