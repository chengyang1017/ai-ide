from pathlib import Path

path = Path('src/ui/runtime_i18n.ts')
text = path.read_text(encoding='utf-8')

exact_entries = [
    ('当前 Electron 环境不支持系统语音', 'System voice is not supported in this Electron environment'),
    ('正在朗读', 'Speaking'),
    ('语音已暂停', 'Voice paused'),
    ('继续朗读', 'Resuming speech'),
    ('系统语音播放失败', 'System voice playback failed'),
    ('终端工作目录无效。', 'Invalid terminal working directory.'),
    ('终端工作目录不是文件夹。', 'Terminal working directory is not a folder.'),
    ('终端尚未启动。', 'Terminal has not started.'),
    ('终端输入无效。', 'Invalid terminal input.'),
    ('单次终端输入过长。', 'Terminal input is too long.'),
    ('当前项目不是可写的本地项目', 'The current project is not a writable local project.'),
    ('项目路径必须是字符串', 'Project path must be a string.'),
    ('不能直接操作项目根目录', 'The project root cannot be modified directly.'),
    ('路径必须位于当前项目内部', 'Path must stay inside the current project.'),
    ('目标不是文件夹', 'Target is not a folder.'),
    ('目标位置已经存在同名文件或文件夹', 'A file or folder with the same name already exists at the destination.'),
    ('不能把文件夹移动到它自己内部', 'A folder cannot be moved inside itself.'),
    ('机器人跟随代码', 'Robot follows code'),
    ('登录后查看你的项目和关注的人', 'Sign in to view your projects and people you follow'),
    ('我的项目', 'My Projects'),
    ('关注的人', 'Following'),
    ('搜索…', 'Search…'),
    ('退出登录', 'Sign Out'),
    ('没有匹配的项目', 'No matching projects'),
    ('没有找到项目', 'No projects found'),
    ('未知语言', 'Unknown language'),
    ('没有匹配的用户', 'No matching users'),
    ('你还没有关注任何用户', 'You are not following anyone yet'),
    ('查看这个用户的公开仓库', "View this user's public repositories"),
    ('正在读取公开仓库…', 'Loading public repositories…'),
    ('读取失败', 'Failed to load'),
    ('正在读取 GitHub…', 'Loading GitHub…'),
    ('GitHub 读取失败', 'Failed to load GitHub'),
    ('✓ 登录成功，正在读取项目…', '✓ Signed in. Loading projects…'),
    ('在 GitHub 授权页输入下面的验证码：', 'Enter this code on the GitHub authorization page:'),
    ('打开 GitHub 授权', 'Open GitHub Authorization'),
    ('我已授权，继续登录', "I've authorized, continue"),
    ('切到 GitHub 完成授权后再回来即可；这个验证码会保留，不需要重新获取。', 'Complete authorization on GitHub, then return here. This code will stay available.'),
    ('GitHub 还没有确认授权。完成授权后回来再点一次即可。', 'GitHub has not confirmed authorization yet. Finish it and try again.'),
    ('GitHub 要求稍等几秒，再检查一次即可。', 'GitHub asked us to wait a few seconds. Try again shortly.'),
    ('检查 GitHub 登录状态失败', 'Failed to check GitHub sign-in status'),
    ('验证码已过期，请重新登录。', 'The code expired. Start sign-in again.'),
    ('正在向 GitHub 申请登录验证码…', 'Requesting a GitHub sign-in code…'),
    ('GitHub 登录失败', 'GitHub sign-in failed'),
    ('🐙 打开 GitHub 仓库', '🐙 Open GitHub Repository'),
    ('粘贴公开 GitHub 仓库或文件链接', 'Paste a public GitHub repository or file URL'),
    ('打开仓库', 'Open Repository'),
    ('请输入 https://github.com/... 链接。', 'Enter a https://github.com/... URL.'),
    ('打开 GitHub 公开仓库', 'Open a public GitHub repository'),
    ('🐙 读取中…', '🐙 Loading…'),
    ('GitHub · 正在读取远程仓库…', 'GitHub · Loading remote repository…'),
    ('读取代码便签失败', 'Failed to load code notes'),
    ('📝 完整单词中间不能插入便签；请把光标移到空格、标点或单词边界。', '📝 A note cannot be inserted in the middle of a word. Move the cursor to whitespace, punctuation, or a word boundary.'),
    ('📝 便签内容已清空；未自动覆盖原便签，如要删除请使用“删除”。', '📝 The note was cleared but the original was not overwritten. Use Delete to remove it.'),
    ('便签至少需要文字或图片。', 'A note needs text or an image.'),
    ('保存中…', 'Saving…'),
    ('没有正在编辑的便签。', 'There is no note being edited.'),
    ('📝 已删除项目代码便签', '📝 Project code note deleted'),
    ('删除代码便签失败', 'Failed to delete code note'),
    ('这里只能插入图片。', 'Only images can be inserted here.'),
    ('导入中…', 'Importing…'),
    ('导入便签图片失败', 'Failed to import note image'),
    ('点击查看大图', 'Click to view full image'),
    ('从便签移除图片', 'Remove image from note'),
    ('行号便签', 'Gutter note'),
    ('点击在行号旁添加项目便签', 'Click to add a project note beside the line number'),
    ('代码便签', 'Code note'),
    ('协作', 'Collaborate'),
    ('请先打开真实项目。', 'Open a real project first.'),
    ('请先打开一个项目。', 'Open a project first.'),
    ('Dart Language Server 尚未启动。', 'Dart Language Server has not started.'),
    ('Windows 原生 TTS 只在 Windows 上可用。', 'Windows native TTS is only available on Windows.'),
    ('单次朗读内容过长，请拆成更短的教学步骤。', 'This speech segment is too long. Split it into shorter teaching steps.'),
    ('Agent 跟随只能用于本地真实项目。', 'Agent follow is only available for local projects.'),
    ('当前没有好友远程项目。', 'There is no active friend remote project.'),
    ('GitHub API 地址无效。', 'Invalid GitHub API address.'),
    ('请先在 IDE 里设置 OpenAI API Key。', 'Set an OpenAI API Key in the IDE first.'),
    ('系统安全存储当前不可用，无法读取 OpenAI API Key。', 'Secure system storage is unavailable, so the OpenAI API Key cannot be read.'),
    ('无法解密已保存的 OpenAI API Key，请重新设置 Key。', 'The saved OpenAI API Key could not be decrypted. Set the key again.'),
    ('只允许打开 http/https 外部链接。', 'Only http/https external links are allowed.'),
    ('delete_file 只允许删除文件，不允许删除目录。', 'delete_file can delete files only, not directories.'),
]

marker = ']);\n\nconst skipSelector = ['
pos = text.find(marker)
if pos < 0:
    raise SystemExit('exact translation insertion marker missing')

additions = []
for zh, en in exact_entries:
    zh_literal = zh.replace('\\', '\\\\').replace("'", "\\'")
    if f"['{zh_literal}'," in text:
        continue
    en_literal = en.replace('\\', '\\\\').replace("'", "\\'")
    additions.append(f"  ['{zh_literal}', '{en_literal}'],")

if additions:
    text = text[:pos] + '\n'.join(additions) + '\n' + text[pos:]

regex_marker = "    [/无法连接 (.+?)。/g, 'Unable to connect to $1.'],\n  ];"
if regex_marker not in text:
    raise SystemExit('regex insertion marker missing')

regex_entries = r"""    [/已缓存 (\d+) 个文本文件；真实写入时机器人会跳到修改位置/g, 'Cached $1 text files; the robot will jump to real edits'],
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
"""

text = text.replace(
    regex_marker,
    "    [/无法连接 (.+?)。/g, 'Unable to connect to $1.'],\n" + regex_entries + '  ];',
    1,
)

path.write_text(text, encoding='utf-8')
print(f'added {len(additions)} exact translations')
