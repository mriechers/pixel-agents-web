import type { WebSocket } from 'ws';
import type { MessageSink } from './types.js';

export class WsManager implements MessageSink {
	private clients = new Set<WebSocket>();

	addClient(ws: WebSocket): void {
		this.clients.add(ws);
		ws.on('close', () => {
			this.clients.delete(ws);
		});
	}

	postMessage(msg: unknown): void {
		const data = JSON.stringify(msg);
		for (const client of this.clients) {
			if (client.readyState === 1) { // WebSocket.OPEN
				client.send(data);
			}
		}
	}

	get clientCount(): number {
		return this.clients.size;
	}
}
