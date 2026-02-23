import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'webview-ui', 'public', 'assets');
const dstDir = path.join(rootDir, 'dist', 'assets');

if (fs.existsSync(srcDir)) {
	if (fs.existsSync(dstDir)) {
		fs.rmSync(dstDir, { recursive: true });
	}
	fs.cpSync(srcDir, dstDir, { recursive: true });
	console.log('Copied assets/ -> dist/assets/');
} else {
	console.log('No assets/ folder found (optional)');
}
