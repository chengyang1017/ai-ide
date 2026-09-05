from pathlib import Path

path = Path('src/ui/runtime_i18n.ts')
text = path.read_text(encoding='utf-8')

exact_entries = [
    ('✍ 默写', '✍ Memorize'),
    ('闭卷默写', 'Closed-book Recall'),
    ('原代码已隐藏。空格、换行和缩进不计错；文字、标识符和符号必须一致。', 'The original code is hidden. Spaces, line breaks, and indentation are ignored; text, identifiers, and symbols must match.'),
    ('实时纠错', 'Live correction'),
    ('从记忆里把刚才选中的代码写出来…', 'Recreate the selected code from memory…'),
    ('原代码', 'Original Code'),
    ('👥 开始共享', '👥 Start Sharing'),
    ('查看答案', 'Show Answer'),
    ('检查', 'Check'),
    ('隐藏答案', 'Hide Answer'),
    ('👥 停止共享', '👥 Stop Sharing'),
    ('共享中 · 好友正在实时看到你的输入', 'Sharing · friends can see your input live'),
    ('✅ 完全正确', '✅ Correct'),
    ('❌ 还不正确。继续修改后可以再次检查。', '❌ Not correct yet. Keep editing and check again.'),
    ('📖 阅读', '📖 Read'),
    ('✏ 编辑', '✏ Edit'),
    ('GitHub 在线仓库当前保持只读阅读模式', 'GitHub online repositories stay in read-only mode'),
    ('进入 Monaco 编辑模式', 'Enter Monaco edit mode'),
    ('📖 GitHub 阅读模式 · 无输入光标与软键盘', '📖 GitHub reading mode · no input cursor or soft keyboard'),
    ('📖 阅读模式 · 无输入光标与软键盘', '📖 Reading mode · no input cursor or soft keyboard'),
    ('✏ 编辑模式 · 点击代码后可以输入', '✏ Edit mode · click code to start typing'),
    ('仓库首页', 'Repository home'),
    ('GitHub 远程仓库已经关闭。', 'The GitHub remote repository is closed.'),
    ('这个 GitHub 仓库没有找到可阅读的文本代码文件。', 'No readable text code files were found in this GitHub repository.'),
    ('GitHub 已连接', 'GitHub Connected'),
    ('复制链接', 'Copy Link'),
    ('在 IDE 打开', 'Open in IDE'),
    ('读取仓库中…', 'Loading repository…'),
    ('GitHub 正在导入', 'Importing from GitHub'),
    ('正在读取仓库文件树。公开仓库不需要登录。', 'Loading the repository file tree. Public repositories do not require sign-in.'),
    ('GitHub 已在 IDE 打开', 'GitHub Opened in IDE'),
    ('重新载入', 'Reload'),
    ('GitHub 仓库读取失败', 'Failed to load GitHub repository'),
    ('GitHub 导入失败', 'GitHub import failed'),
    ('重试', 'Retry'),
    ('正在把这个 GitHub 仓库直接载入 IDE…', 'Loading this GitHub repository directly into the IDE…'),
    ('✓ 已复制', '✓ Copied'),
    ('AI 导师', 'AI Tutor'),
    ('更多工具', 'More Tools'),
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

regex_marker = "    [/GitHub 请求失败 · HTTP/g, 'GitHub request failed · HTTP'],\n  ];"
if regex_marker not in text:
    raise SystemExit('third-pass regex marker missing')

regex_entries = r"""    [/⚠ 写错了 · 第 (\d+) 个有效字符/g, '⚠ Mismatch · effective character $1'],
    [/第 (\d+) 行/g, 'Line $1'],
    [/第 (\d+)–(\d+) 行 · (\d+) 行代码/g, 'Lines $1–$2 · $3 lines of code'],
    [/✍ (.+?) 正在默写/g, '✍ $1 is memorizing'],
    [/👥 已跳到共享阅读位置 · /g, '👥 Jumped to shared reading position · '],
    [/GitHub 仓库中没有这个代码文件：/g, 'This code file is not in the GitHub repository: '],
    [/GitHub 在线仓库目前是只读模式，不能直接保存 (.+?)。/g, 'GitHub online repositories are read-only; cannot save $1 directly.'],
    [/✓ GitHub · (.+?) · (.+?) · (\d+) 个代码文件 · 只读/g, '✓ GitHub · $1 · $2 · $3 code files · read-only'],
    [/(\d+) 个代码文件 · (.+?) · 当前为只读阅读模式。/g, '$1 code files · $2 · read-only reading mode.'],
    [/✓ GitHub · (.+?) · (\d+) 个代码文件/g, '✓ GitHub · $1 · $2 code files'],
"""

text = text.replace(
    regex_marker,
    "    [/GitHub 请求失败 · HTTP/g, 'GitHub request failed · HTTP'],\n" + regex_entries + '  ];',
    1,
)

path.write_text(text, encoding='utf-8')
print(f'added {len(additions)} exact translations')
