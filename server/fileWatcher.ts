import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentState, MessageSink } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS, ACTIVE_SESSION_MAX_AGE_MS } from './constants.js';

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, sink);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	const interval = setInterval(() => {
		if (!agents.has(agentId)) { clearInterval(interval); return; }
		readNewLines(agentId, agents, waitingTimers, permissionTimers, sink);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) return;

		const buf = Buffer.alloc(stat.size - agent.fileOffset);
		const fd = fs.openSync(agent.jsonlFile, 'r');
		fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
		fs.closeSync(fd);
		agent.fileOffset = stat.size;

		const text = agent.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		agent.lineBuffer = lines.pop() || '';

		const hasLines = lines.some(l => l.trim());
		if (hasLines) {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				sink?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}

		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, sink);
		}
	} catch (e) {
		console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
	}
}

export function ensureProjectScan(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	if (projectScanTimerRef.current) return;

	// On first scan, adopt recently active JSONL files (not just mark them known)
	try {
		const now = Date.now();
		const files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		for (const f of files) {
			knownJsonlFiles.add(f);
			try {
				const stat = fs.statSync(f);
				if (now - stat.mtimeMs < ACTIVE_SESSION_MAX_AGE_MS) {
					adoptJsonlFile(
						f, projectDir,
						nextAgentIdRef, agents,
						fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						sink,
					);
				}
			} catch { /* file may have been deleted */ }
		}
		// After initial adoption, find team members of adopted agents
		adoptTeamMembers(
			projectDir, files, agents,
			knownJsonlFiles, nextAgentIdRef,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			sink,
		);
	} catch { /* dir may not exist yet */ }

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			sink,
		);
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewJsonlFiles(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	for (const file of files) {
		if (!knownJsonlFiles.has(file)) {
			knownJsonlFiles.add(file);
			// Check if any existing agent already has this JSONL (reassignment)
			let reassigned = false;
			for (const [agentId, agent] of agents) {
				if (agent.jsonlFile !== file) continue;
				// Already tracking, skip
				reassigned = true;
				break;
			}
			if (reassigned) continue;

			// Auto-adopt: create a new agent for this JSONL file
			adoptJsonlFile(
				file, projectDir,
				nextAgentIdRef, agents,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				sink,
			);
		}
	}
}

/** Read teamName from the first line of a JSONL file (fast, no full parse) */
function readTeamName(filePath: string): string | null {
	try {
		const fd = fs.openSync(filePath, 'r');
		const buf = Buffer.alloc(4096);
		const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
		fs.closeSync(fd);
		const firstLine = buf.subarray(0, bytesRead).toString('utf-8').split('\n')[0];
		if (!firstLine) return null;
		const record = JSON.parse(firstLine);
		return typeof record.teamName === 'string' ? record.teamName : null;
	} catch {
		return null;
	}
}

/** After initial adoption, find JSONL files belonging to same teams as adopted agents */
function adoptTeamMembers(
	projectDir: string,
	allFiles: string[],
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	// Collect team names from already-adopted agents
	const activeTeams = new Set<string>();
	for (const agent of agents.values()) {
		if (agent.teamName && agent.projectDir === projectDir) {
			activeTeams.add(agent.teamName);
		}
	}
	if (activeTeams.size === 0) return;

	// Collect already-adopted JSONL paths
	const adoptedFiles = new Set<string>();
	for (const agent of agents.values()) {
		adoptedFiles.add(agent.jsonlFile);
	}

	// Check non-adopted files for matching teamName
	for (const f of allFiles) {
		if (adoptedFiles.has(f)) continue;
		const teamName = readTeamName(f);
		if (teamName && activeTeams.has(teamName)) {
			console.log(`[Pixel Agents] Adopting team member: ${path.basename(f)} (team: ${teamName})`);
			adoptJsonlFile(
				f, projectDir,
				nextAgentIdRef, agents,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				sink,
			);
		}
	}
}

function deriveProjectName(projectDir: string): string {
	const dirName = path.basename(projectDir);
	const homeEncoded = os.homedir().replace(/[/\\:]/g, '-');
	let rest = dirName;
	if (rest.startsWith(homeEncoded)) {
		rest = rest.slice(homeEncoded.length);
	}
	// Strip one level of intermediate directory (e.g., -Desktop-)
	const match = rest.match(/^-(\w+)-(.+)$/);
	if (match) {
		return match[2];
	}
	return rest.replace(/^-/, '') || dirName;
}

function adoptJsonlFile(
	jsonlFile: string,
	projectDir: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sink: MessageSink | undefined,
): void {
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		projectDir,
		jsonlFile,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};

	agent.projectName = deriveProjectName(projectDir);
	agents.set(id, agent);

	console.log(`[Pixel Agents] Agent ${id}: adopted JSONL file ${path.basename(jsonlFile)} (project: ${agent.projectName})`);
	sink?.postMessage({ type: 'agentCreated', id });
	sink?.postMessage({ type: 'agentMeta', id, projectName: agent.projectName });

	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, sink);
	readNewLines(id, agents, waitingTimers, permissionTimers, sink);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);

	agents.delete(agentId);
}
