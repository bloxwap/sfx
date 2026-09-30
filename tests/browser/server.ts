import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const root = resolve('.');
createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'tests/browser/fixture.html' : `.${path}`);
    if (!file.startsWith(root + sep)) throw new Error('Outside root');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
}).listen(3908, '127.0.0.1');
