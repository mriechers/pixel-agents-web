# Pixel Agents Web

A standalone web app that turns your Claude Code agents into animated pixel art characters in a virtual office.

Based on the [Pixel Agents VS Code extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents), this web version runs independently in any browser. It watches Claude Code's JSONL transcript files to auto-discover all active sessions across your machine — no VS Code required.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **Auto-discovery** — automatically detects all active Claude Code sessions across all projects
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Agent metadata** — labels show project name, model (opus/sonnet/haiku), and git branch for each agent
- **Team visualization** — agents in the same Claude Code team get color-coded badges and are seated near each other
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters with their role name (e.g. "pm", "lead", "qa")
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Persistent layouts** — your office design is saved to `~/.pixel-agents/layout.json`
- **Diverse characters** — 6 unique character skins with automatic hue-shifted variants beyond 6 agents

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and running sessions

## Getting Started

```bash
git clone https://github.com/pablodelucca/pixel-agents-web.git
cd pixel-agents-web
npm install
cd webview-ui && npm install && cd ..
npm run build
npm start
```

Then open **http://localhost:3333** in your browser. Any active Claude Code sessions will be auto-discovered and appear as characters.

### Usage

1. Start one or more Claude Code sessions anywhere on your machine
2. Open **http://localhost:3333** — agents appear automatically as characters
3. Watch characters react in real time as agents use tools
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

The office tileset used in this project and available via the extension is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

This is the only part of the project that is not freely available. The tileset is not included in this repository due to its license. To use Pixel Agents locally with the full set of office furniture and decorations, purchase the tileset and run the asset import pipeline:

```bash
npm run import-tileset
```

Fair warning: the import pipeline is not exactly straightforward — the out-of-the-box tileset assets aren't the easiest to work with, and while I've done my best to make the process as smooth as possible, it may require some manual tweaking. If you have experience creating pixel art office assets and would like to contribute freely usable tilesets for the community, that would be hugely appreciated.

The extension will still work without the tileset — you'll get the default characters and basic layout, but the full furniture catalog requires the imported assets.

## How It Works

The server watches Claude Code's JSONL transcript files at `~/.claude/projects/` to track what each agent is doing. When an agent uses a tool (like writing a file or running a command), the server detects it and pushes updates to the browser via WebSocket. No modifications to Claude Code are needed — it's purely observational.

Key differences from the VS Code extension:
- **Standalone server** — Express + WebSocket instead of VS Code Webview API
- **Auto-discovery** — scans all `~/.claude/projects/` directories for active sessions instead of managing terminals
- **Team member adoption** — detects team member JSONL files (spawned by Claude Code's `Task` tool with `team_name`) and adopts them even if they're older than the normal 5-minute recency window
- **Agent metadata** — extracts model, git branch, team name, and project name from JSONL records

The frontend runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle -> walk -> type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Server**: TypeScript, Express, WebSocket (ws), Node.js
- **Frontend**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and may briefly show the wrong status.
- **No terminal management** — unlike the VS Code extension, the web version cannot launch or close Claude Code sessions. It's read-only — you manage sessions separately.
- **Session discovery delay** — new sessions are discovered by polling (every 2 seconds). There may be a brief delay before a new agent appears.

## Roadmap

There are several areas where contributions would be very welcome:

- **Better status detection** — find or propose clearer signals for agent state transitions (waiting, done, permission needed)
- **Community assets** — freely usable pixel art tilesets or characters that anyone can use without purchasing third-party assets
- **Desks as directories** — click on a desk to select a working directory, visually group agents by project
- **Git worktree support** — agents working in different worktrees to avoid conflict from parallel work on the same files
- **Support for other agentic frameworks** — [OpenCode](https://github.com/nichochar/opencode), or really any kind of agentic experiment you'd want to run inside a pixel art interface (see [simile.ai](https://simile.ai/) for inspiration)
- **Docker support** — containerized deployment for always-on dashboards

If any of these interest you, feel free to open an issue or submit a PR.

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for instructions on how to contribute to this project.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Credits

Based on the [Pixel Agents VS Code extension](https://github.com/pablodelucca/pixel-agents) by Pablo de Lucca.

## License

This project is licensed under the [MIT License](LICENSE).
