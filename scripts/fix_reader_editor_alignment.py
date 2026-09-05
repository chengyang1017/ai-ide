from pathlib import Path

path = Path('src/reader/reader_surface.ts')
text = path.read_text(encoding='utf-8')

# 1) Add one shared top-padding reader so Reader scroll math uses the same
# coordinate system as Monaco's editor padding.
marker = '''  const lineHeight =\n    (): number => {\n      const value =\n        Number.parseFloat(\n          getComputedStyle(\n            code,\n          ).lineHeight,\n        );\n\n      return Number.isFinite(value)\n        && value > 0\n        ? value\n        : 24;\n    };\n'''
replacement = marker + '''\n  const codeTopPadding =\n    (): number => {\n      const value =\n        Number.parseFloat(\n          getComputedStyle(\n            document.documentElement,\n          )\n            .getPropertyValue(\n              '--code-top-padding',\n            ),\n        );\n\n      return Number.isFinite(value)\n        && value >= 0\n        ? value\n        : 42;\n    };\n'''
if marker not in text:
    raise SystemExit('lineHeight marker not found')
text = text.replace(marker, replacement, 1)

# 2) currentViewport: scrollTop includes the shared top padding. Do not count
# those 42px as almost two source lines.
old = '''      const startLine =\n        Math.max(\n          1,\n          Math.min(\n            count,\n            Math.floor(\n              scroll.scrollTop\n                / height,\n            ) + 1,\n          ),\n        );\n\n      const visibleLines =\n        Math.max(\n          1,\n          Math.ceil(\n            scroll.clientHeight\n              / height,\n          ),\n        );\n'''
new = '''      const topPadding =\n        codeTopPadding();\n\n      const contentScrollTop =\n        Math.max(\n          0,\n          scroll.scrollTop\n            - topPadding,\n        );\n\n      const startLine =\n        Math.max(\n          1,\n          Math.min(\n            count,\n            Math.floor(\n              contentScrollTop\n                / height,\n            ) + 1,\n          ),\n        );\n\n      const topInset =\n        Math.max(\n          0,\n          topPadding\n            - scroll.scrollTop,\n        );\n\n      const visibleLines =\n        Math.max(\n          1,\n          Math.ceil(\n            Math.max(\n              height,\n              scroll.clientHeight\n                - topInset,\n            )\n              / height,\n          ),\n        );\n'''
if old not in text:
    raise SystemExit('currentViewport marker not found')
text = text.replace(old, new, 1)

# 3) revealReaderLine must use the same top padding as Monaco.
old = '''    scroll.scrollTop =\n      Math.max(\n        0,\n        (\n          safeLine - 1\n        ) * lineHeight(),\n      );\n'''
new = '''    scroll.scrollTop =\n      Math.max(\n        0,\n        codeTopPadding()\n          + (\n            safeLine - 1\n          ) * lineHeight(),\n      );\n'''
if old not in text:
    raise SystemExit('revealReaderLine marker not found')
text = text.replace(old, new, 1)

# 4) Mode switching must not run a second, line-based position system on top
# of reader_editor_view_sync. Preserve render/layout only.
old = '''    if (\n      effectiveMode\n        === 'reader'\n    ) {\n      const firstVisible =\n        editor\n          .getVisibleRanges()[0]\n          ?.startLineNumber\n          ?? 1;\n\n      editorStage.dataset\n        .editorSurface =\n          'reader';\n\n      surface.hidden = false;\n\n      await renderCurrentFile();\n\n      requestAnimationFrame(\n        () => {\n          revealReaderLine(\n            firstVisible,\n          );\n        },\n      );\n\n      if (announce) {\n'''
new = '''    if (\n      effectiveMode\n        === 'reader'\n    ) {\n      editorStage.dataset\n        .editorSurface =\n          'reader';\n\n      surface.hidden = false;\n\n      await renderCurrentFile();\n\n      if (announce) {\n'''
if old not in text:
    raise SystemExit('reader setMode marker not found')
text = text.replace(old, new, 1)

old = '''    const readerLine =\n      currentViewport()\n        .startLine;\n\n    editorStage.dataset\n      .editorSurface =\n        'editor';\n\n    surface.hidden = true;\n    clearReaderSelection();\n\n    requestAnimationFrame(\n      () => {\n        editor.layout();\n        editor.revealLineNearTop(\n          readerLine,\n        );\n      },\n    );\n'''
new = '''    editorStage.dataset\n      .editorSurface =\n        'editor';\n\n    surface.hidden = true;\n    clearReaderSelection();\n\n    requestAnimationFrame(\n      () => {\n        editor.layout();\n      },\n    );\n'''
if old not in text:
    raise SystemExit('editor setMode marker not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('reader/editor coordinate systems unified')
