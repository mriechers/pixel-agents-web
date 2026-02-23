type MessageHandler = (e: MessageEvent) => void;

const handlers = new Set<MessageHandler>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DELAY_MS = 2000;

function getWsUrl(): string {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${location.host}`;
}

function connect(): void {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return;
	}

	const url = getWsUrl();
	ws = new WebSocket(url);

	ws.onopen = () => {
		console.log('[WS] Connected');
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	ws.onmessage = (e: MessageEvent) => {
		try {
			const data = JSON.parse(e.data as string);
			// Wrap in the same format as VS Code postMessage
			const event = new MessageEvent('message', { data });
			for (const handler of handlers) {
				handler(event);
			}
		} catch (err) {
			console.error('[WS] Error parsing message:', err);
		}
	};

	ws.onclose = () => {
		console.log('[WS] Disconnected — will reconnect');
		ws = null;
		scheduleReconnect();
	};

	ws.onerror = () => {
		// onclose will fire after this
		ws?.close();
	};
}

function scheduleReconnect(): void {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, RECONNECT_DELAY_MS);
}

// Initialize connection immediately
connect();

export const vscode = {
	postMessage(msg: unknown): void {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	},
};

export function addWsMessageHandler(handler: MessageHandler): void {
	handlers.add(handler);
}

export function removeWsMessageHandler(handler: MessageHandler): void {
	handlers.delete(handler);
}
