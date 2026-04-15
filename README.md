# Jira Exporter

Chrome extension that exports Jira tickets into a ZIP — description, comments, attachments, and linked issues as clean Markdown.

Uses your existing Jira session cookies — no API tokens needed.

## Features

- Exports ticket details, description, comments, and attachments
- Recursively crawls linked issues, subtasks, and parent tickets (configurable depth, default 4)
- Converts HTML to Markdown
- Optional INDEX.md with navigation structure
- All settings accessible from the popup: link depth, context mode, attachments, comments, save-as dialog, context menu
- Works on any `*.atlassian.net` Jira Cloud instance

## Build

Requires Nix with flakes. From the repo root:

```sh
nix run
```

This pulls in Node + pnpm, installs deps, and builds everything into `dist/`.

Alternatively, if you're already in the dev shell (`direnv allow` or `nix develop`):

```sh
pnpm install && pnpm build
```

## Usage

1. Go to `chrome://extensions`, enable Developer mode, click "Load unpacked" and point it at `dist/`.
2. Open any Jira ticket (`https://<org>.atlassian.net/browse/PROJ-123`).
3. Click the extension icon and hit Export, or right-click → "Export Jira Ticket to ZIP".

## Development

Scaffolded and iterated using a custom agentic pipeline built on Qwen 3.5 27B, with human-in-the-loop review at every step. The architecture, prompt chains, and tooling orchestration are my own work — the model handled the bulk code generation under directed supervision.

## License

MIT — Jacek Azelski
