import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WsManager } from './wsManager.js';
import type { MessageSink, AgentState } from './types.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
	loadDefaultLayout,
	sendAllAssetsToSink,
} from './assetLoader.js';
import type { LoadedAssets, LoadedFloorTiles, LoadedWallTiles, LoadedCharacterSprites } from './assetLoader.js';
import { loadLayout, writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { ensureProjectScan, removeAgent } from './fileWatcher.js';
import { findProcessForFile, killProcess } from './processKiller.js';
import { DEFAULT_PORT } from './constants.js';

// ── Resolve the project root (repo root) ────────────────────
// Server runs from dist/server/server.js → go up two levels
const serverDir = path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(serverDir, '..', '..');

// ── State ────────────────────────────────────────────────────
const wsManager = new WsManager();

const nextAgentId = { current: 1 };
const agents = new Map<number, AgentState>();
const knownJsonlFiles = new Set<string>();
const projectScanTimers = new Map<string, { current: ReturnType<typeof setInterval> | null }>();

const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

let cachedCharSprites: LoadedCharacterSprites | null = null;
let cachedFloorTiles: LoadedFloorTiles | null = null;
let cachedWallTiles: LoadedWallTiles | null = null;
let cachedFurnitureAssets: LoadedAssets | null = null;
let cachedLayout: Record<string, unknown> | null = null;
let defaultLayout: Record<string, unknown> | null = null;
let soundEnabled = true;
let layoutWatcher: LayoutWatcher | null = null;

// ── Discover project directories ─────────────────────────────
function getProjectDirs(): string[] {
	const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
	if (!fs.existsSync(claudeProjectsDir)) return [];
	try {
		return fs.readdirSync(claudeProjectsDir)
			.map(d => path.join(claudeProjectsDir, d))
			.filter(d => {
				try { return fs.statSync(d).isDirectory(); }
				catch { return false; }
			});
	} catch { return []; }
}

// ── Load all assets ──────────────────────────────────────────
async function loadAllAssets(): Promise<void> {
	// Check bundled path first (dist/assets/), then project root (assets/)
	const distAssetsDir = path.join(projectRoot, 'dist', 'assets');
	let assetsRoot: string;
	if (fs.existsSync(distAssetsDir)) {
		assetsRoot = path.join(projectRoot, 'dist');
	} else {
		// Development: assets in webview-ui/public/assets/
		const devAssetsDir = path.join(projectRoot, 'webview-ui', 'public', 'assets');
		if (fs.existsSync(devAssetsDir)) {
			assetsRoot = path.join(projectRoot, 'webview-ui', 'public');
		} else {
			assetsRoot = projectRoot;
		}
	}

	console.log(`[Server] Using assets root: ${assetsRoot}`);

	defaultLayout = loadDefaultLayout(assetsRoot);
	cachedCharSprites = await loadCharacterSprites(assetsRoot);
	cachedFloorTiles = await loadFloorTiles(assetsRoot);
	cachedWallTiles = await loadWallTiles(assetsRoot);
	cachedFurnitureAssets = await loadFurnitureAssets(assetsRoot);
	cachedLayout = loadLayout(defaultLayout);
}

// ── Start scanning for JSONL sessions ────────────────────────
function startProjectScanning(): void {
	const projectDirs = getProjectDirs();
	console.log(`[Server] Found ${projectDirs.length} project directories`);

	const startScanForDir = (dir: string) => {
		if (!projectScanTimers.has(dir)) {
			projectScanTimers.set(dir, { current: null });
		}
		ensureProjectScan(
			dir, knownJsonlFiles, projectScanTimers.get(dir)!,
			nextAgentId, agents,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			wsManager,
		);
	};

	for (const projectDir of projectDirs) {
		startScanForDir(projectDir);
	}

	// Also re-scan for new project directories periodically
	setInterval(() => {
		const dirs = getProjectDirs();
		for (const dir of dirs) {
			startScanForDir(dir);
		}
	}, 5000);
}

// ── Send current state to a newly connected client ───────────
function sendInitialState(clientSink: MessageSink): void {
	// Send settings
	clientSink.postMessage({ type: 'settingsLoaded', soundEnabled });

	// Send existing agents BEFORE layout — client buffers them
	// and adds characters when layoutLoaded arrives
	const agentIds: number[] = [];
	const agentMeta: Record<number, { model?: string; projectName?: string; gitBranch?: string; teamName?: string }> = {};
	for (const [id, agent] of agents) {
		agentIds.push(id);
		const meta: { model?: string; projectName?: string; gitBranch?: string; teamName?: string } = {};
		if (agent.model) meta.model = agent.model;
		if (agent.projectName) meta.projectName = agent.projectName;
		if (agent.gitBranch) meta.gitBranch = agent.gitBranch;
		if (agent.teamName) meta.teamName = agent.teamName;
		if (Object.keys(meta).length > 0) {
			agentMeta[id] = meta;
		}
	}
	agentIds.sort((a, b) => a - b);

	clientSink.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
	});

	// Send all assets + layout (layoutLoaded is last, drains the agent buffer)
	sendAllAssetsToSink(
		clientSink,
		cachedCharSprites,
		cachedFloorTiles,
		cachedWallTiles,
		cachedFurnitureAssets,
		cachedLayout,
	);

	// Re-send active tool states
	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			clientSink.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		if (agent.isWaiting) {
			clientSink.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	}
}

// ── Handle incoming WebSocket messages ───────────────────────
function handleClientMessage(data: string): void {
	try {
		const message = JSON.parse(data);

		if (message.type === 'webviewReady') {
			// Client is ready — but we send initial state on connection anyway
			// This handles reconnection
		} else if (message.type === 'saveLayout') {
			layoutWatcher?.markOwnWrite();
			const layout = message.layout as Record<string, unknown>;
			writeLayoutToFile(layout);
			cachedLayout = layout;
			// Broadcast to all clients so imports take effect immediately
			wsManager.postMessage({ type: 'layoutLoaded', layout });
		} else if (message.type === 'setSoundEnabled') {
			soundEnabled = message.enabled as boolean;
		} else if (message.type === 'saveAgentSeats') {
			// No-op in web mode — seat assignments are ephemeral
		} else if (message.type === 'focusAgent') {
			// No-op — no terminals to focus
		} else if (message.type === 'closeAgent') {
			const id = message.id as number;
			const agent = agents.get(id);
			if (agent) {
				console.log(`[Server] Attempting to stop agent ${id} (${agent.jsonlFile})`);
				findProcessForFile(agent.jsonlFile).then(async (pid) => {
					if (pid) {
						console.log(`[Server] Found PID ${pid} for agent ${id}, sending SIGINT`);
						const killed = await killProcess(pid);
						if (killed) {
							console.log(`[Server] Sent SIGINT to PID ${pid}`);
						} else {
							console.log(`[Server] Failed to send SIGINT to PID ${pid}`);
						}
					} else {
						console.log(`[Server] No process found for agent ${id}, removing from tracking`);
					}
					// Remove from tracking regardless
					removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers);
					wsManager.postMessage({ type: 'agentClosed', id });
				}).catch(err => {
					console.error(`[Server] Error stopping agent ${id}:`, err);
				});
			}
		} else if (message.type === 'openClaude') {
			// No-op — agents are auto-discovered from JSONL
		} else if (message.type === 'openSessionsFolder') {
			// No-op — no OS integration
		} else if (message.type === 'exportLayout') {
			// Handled on client side in web mode
		} else if (message.type === 'importLayout') {
			// Handled on client side in web mode
		}
	} catch (err) {
		console.error('[Server] Error handling client message:', err);
	}
}

// ── Main ─────────────────────────────────────────────────────
async function main(): Promise<void> {
	const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

	console.log('[Server] Loading assets...');
	await loadAllAssets();

	// Start layout watcher
	layoutWatcher = watchLayoutFile((layout) => {
		console.log('[Server] External layout change — broadcasting to clients');
		cachedLayout = layout;
		wsManager.postMessage({ type: 'layoutLoaded', layout });
	});

	// Start scanning for JSONL sessions
	startProjectScanning();

	// Express app
	const app = express();

	// Serve the built webview
	const webviewDistDir = path.join(projectRoot, 'dist', 'webview');
	if (fs.existsSync(webviewDistDir)) {
		app.use(express.static(webviewDistDir));
	} else {
		console.warn(`[Server] Webview dist not found at ${webviewDistDir}`);
	}

	// Serve assets (for any direct asset references)
	const assetsDir = path.join(projectRoot, 'dist', 'assets');
	if (fs.existsSync(assetsDir)) {
		app.use('/assets', express.static(assetsDir));
	}

	// API endpoint for layout export
	app.get('/api/layout', (_req, res) => {
		const layout = readLayoutFromFile();
		if (layout) {
			res.json(layout);
		} else {
			res.status(404).json({ error: 'No saved layout found' });
		}
	});

	// Create HTTP server
	const server = http.createServer(app);

	// WebSocket server on the same port
	const wss = new WebSocketServer({ server });

	wss.on('connection', (ws: WebSocket) => {
		console.log(`[Server] Client connected (total: ${wsManager.clientCount + 1})`);
		wsManager.addClient(ws);

		// Create a per-client sink for initial state
		const clientSink: MessageSink = {
			postMessage(msg: unknown): void {
				if (ws.readyState === 1) {
					ws.send(JSON.stringify(msg));
				}
			}
		};

		sendInitialState(clientSink);

		ws.on('message', (raw) => {
			handleClientMessage(raw.toString());
		});

		ws.on('close', () => {
			console.log(`[Server] Client disconnected (remaining: ${wsManager.clientCount})`);
		});
	});

	server.listen(port, () => {
		console.log(`[Server] Pixel Agents Web running at http://localhost:${port}`);
	});
}

main().catch(err => {
	console.error('[Server] Fatal error:', err);
	process.exit(1);
});
