import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// Serves the package root, so the fixture can import the built dist/ like an app would.
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'test/browser/fixture.html' : `.${path}`);
    if (!file.startsWith(root + sep)) throw new Error('Outside root');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
}).listen(3908, '127.0.0.1');
