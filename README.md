# Code Tutor Studio

[English](README.md) | [简体中文](README.zh-CN.md)

A standalone developer learning environment where an animated AI tutor can explain **real project code directly inside the editor**.

Code Tutor Studio is not designed as a conventional “AI chat sidebar.” The tutor follows code, moves between real files, uses semantic information from the Dart Analysis Server, and turns project structure into an interactive teaching flow.

The project combines a desktop IDE experience, mobile/tablet reading workflows, persistent code notes, speech synthesis, semantic navigation, and project-aware learning tools.

---

## Screenshots

> Screenshot placeholders are intentionally kept here. Add the images under `docs/screenshots/` when ready.

### Desktop IDE

📸 **Screenshot placeholder:** `docs/screenshots/desktop-ide.png`

### AI Tutor Inside the Editor

📸 **Screenshot placeholder:** `docs/screenshots/ai-tutor.png`

### Dart Semantic Navigation

📸 **Screenshot placeholder:** `docs/screenshots/dart-navigation.png`

### Persistent Code Notes

📸 **Screenshot placeholder:** `docs/screenshots/code-notes.png`

### Tablet / Mobile Reader

📸 **Screenshot placeholder:** `docs/screenshots/tablet-reader.png`

### Appearance / Background Customization

📸 **Screenshot placeholder:** `docs/screenshots/appearance.png`

### Shared Reader Session

📸 **Screenshot placeholder:** `docs/screenshots/shared-reader.png`

---

## Why This Project Exists

Most AI coding tools put the assistant beside the code.

Code Tutor Studio explores a different interaction model:

```text
Real project
    ↓
Semantic code structure
    ↓
Teaching route
    ↓
Tutor moves to the relevant file / line
    ↓
Highlight + explanation + speech
```

The goal is to make code explanation feel closer to a guided walkthrough of the actual project rather than a disconnected chat conversation.

---

## Core Features

### Project-aware Code Editor

- Open real projects and browse the project tree
- Monaco Editor-based editing
- Real file editing and `Ctrl+S` disk writes
- Unsaved-state tracking
- Session restoration for previously opened projects and files
- Desktop-focused IDE layout

### AI Tutor in the Code View

The animated tutor is positioned directly around the code area instead of living permanently in a separate chat panel.

It can:

- Move between teaching targets
- Follow a generated `TutorMove[]` route
- Highlight relevant code
- Show compact explanation text
- Read explanations aloud
- Avoid covering important code where possible

### Dart Semantic Navigation

The project integrates with the **Dart Analysis Server** for project-aware semantic information.

Current Dart-oriented capabilities include:

- Definition navigation
- References
- Document symbols
- Call hierarchy
- Function / method / constructor discovery
- `Ctrl+Click` semantic navigation

A typical teaching flow can be understood as:

```text
Selected Dart function
        ↓
Dart Analysis Server
        ↓
Real semantic nodes
        ↓
AI organizes the teaching order
        ↓
Tutor moves across files
```

The AI is not expected to invent arbitrary project locations; semantic data provides the real code targets first.

### Persistent Code Notes

Code Tutor Studio supports notes that remain attached to code without modifying the source file itself.

Notes can be displayed:

- Beside the code
- Near the line-number gutter

Project-level notes can be stored under:

```text
.ai-code-tutor/
├── notes.json
└── assets/
```

This makes the notes suitable for sharing through Git together with a project.

The note system also supports:

- Persistent text notes
- Image attachments
- Clipboard image paste
- Drag-and-drop images
- Anchor text for relocation after nearby code changes
- Automatic local migration from older note storage

### Speech / Tutor Voice

On Windows, the application can use native speech synthesis through Electron.

```text
TutorMove.speech
      ↓
Voice Controller
      ↓ IPC
Electron Main
      ↓
Windows.Media.SpeechSynthesis
      ↓
Audio playback
      ↓
Tutor speaking animation
```

Voice preferences can include language, voice selection, speaking rate, and enabled state.

### Secure Local API Key Storage

The desktop application can store an OpenAI API key through Electron `safeStorage`.

On Windows, this uses the current user's DPAPI-backed protection rather than storing the key as plain text.

```text
API Key
   ↓
Electron safeStorage
   ↓
Windows DPAPI
   ↓
Encrypted local state
```

### Tablet / Mobile Reading

The repository also contains Android / Capacitor and tablet-oriented code paths for reading and learning workflows on smaller screens.

The goal is not to shrink the desktop IDE blindly. Smaller devices need different behavior, especially for source-code layout and navigation.

The project therefore experiments with:

- Tablet-specific layouts
- Mobile reader sessions
- Responsive code presentation
- Reader-focused controls

### Shared Reader Sessions

The project includes a lightweight reader-room server and WebSocket support for shared reading/session workflows.

This expands the project beyond a purely single-device editor and provides a base for collaborative learning experiences.

---

## Architecture

At a high level:

```text
┌──────────────────────────────┐
│ Vite + TypeScript Renderer   │
│ Monaco Editor                │
└──────────────┬───────────────┘
               │
               │ IPC
               ▼
┌──────────────────────────────┐
│ Electron Main Process        │
│ File system / safeStorage    │
│ Native Windows TTS           │
└──────────────┬───────────────┘
               │
               ├───────────────► Dart Analysis Server
               │
               └───────────────► Local project files

Optional reader / sharing paths:

Android / Capacitor
        │
        ▼
Reader workflow
        │
        ▼
WebSocket reader-room server
```

---

## Project Structure

The current repository contains separate areas for desktop, editor, reader, tablet, notes, project state, and the tutor character.

```text
code-tutor-studio/
├── android/
├── electron/
├── server/
├── src/
│   ├── android/
│   ├── character/
│   ├── core/
│   ├── demo/
│   ├── desktop/
│   ├── editor/
│   ├── memorize/
│   ├── notes/
│   ├── project/
│   ├── reader/
│   └── tablet/
├── capacitor.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Tech Stack

### Desktop

- Electron
- TypeScript
- Vite
- Monaco Editor

### Code Intelligence

- Dart Analysis Server
- Definition / references / call hierarchy
- Project-level semantic navigation

### Mobile / Tablet

- Capacitor
- Android
- Responsive reader-specific UI

### Communication / Data

- WebSocket (`ws`)
- PostgreSQL client (`pg`)

### Local Desktop Integration

- Electron IPC
- File-system access
- `safeStorage`
- Windows native speech synthesis

---

## Development

Install dependencies:

```bash
npm install
```

Type-check:

```bash
npm run typecheck
```

Run the desktop development environment:

```bash
npm run dev
```

Build the renderer:

```bash
npm run build
```

Package for Windows:

```bash
npm run package:win
```

Run the reader-room server:

```bash
npm run reader:server
```

Dart semantic features require a locally available Dart SDK:

```bash
dart --version
```

---

## Current Capabilities

```text
Real project file tree
+ Monaco-based code editor
+ Real Ctrl+S file writes
+ Dart Definition / References / Call Hierarchy
+ Ctrl+Click semantic navigation
+ AI-organized semantic teaching routes
+ Animated tutor moving across files
+ Windows native TTS
+ Persistent project code notes
+ Note image attachments
+ Session restoration
+ Tablet / Android reader experiments
+ Shared reader-room foundation
```

---

## Current Limitations

- Full semantic language support is currently strongest for Dart / Flutter projects.
- The project is still an experimental learning environment rather than a complete replacement for VS Code or Android Studio.
- Advanced IDE features such as a full debugger, integrated terminal, Git UI, and conflict-resolution workflows are not yet complete.
- Native voice availability depends on voices exposed by the operating system.
- Mobile and tablet workflows are evolving separately from the desktop editor.

---

## Design Direction

Code Tutor Studio is built around one idea:

> Code learning should happen as close as possible to the real code being explained.

Instead of separating the explanation from the project, the tool tries to combine:

```text
Code
+
Semantic structure
+
AI explanation
+
Navigation
+
Voice
+
Persistent learning notes
```

into one developer-learning environment.

---

## Status

**Active development.**

The project currently includes the Electron desktop IDE, Monaco-based editor, Dart semantic navigation, animated tutor flows, persistent code notes, native Windows speech integration, Android / tablet reader work, and shared reader-session infrastructure.
