import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Find the PID of the process writing to a file using lsof.
 * Returns the PID or null if not found.
 */
export async function findProcessForFile(filePath: string): Promise<number | null> {
	try {
		// Use lsof to find processes with the file open for writing
		const { stdout } = await execAsync(`lsof -t "${filePath}" 2>/dev/null`);
		const pids = stdout.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
		if (pids.length === 0) return null;
		// Filter out our own PID
		const ownPid = process.pid;
		const filtered = pids.filter(p => p !== ownPid);
		return filtered.length > 0 ? filtered[0] : null;
	} catch {
		return null;
	}
}

/**
 * Send SIGINT to a process (graceful shutdown, same as Ctrl+C).
 * Returns true if signal was sent successfully.
 */
export async function killProcess(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 'SIGINT');
		return true;
	} catch {
		return false;
	}
}
