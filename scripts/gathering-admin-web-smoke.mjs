import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '../apps/gathering-admin/dist');
const index = await readFile(join(dist, 'index.html'), 'utf8');
if (!index.includes('id="root"') || index.includes('/src/main.tsx')) {
  throw new Error('production index가 아닙니다. npm run build -w @member/gathering-admin 를 먼저 실행하세요.');
}

const upstream = createServer((request, response) => {
  response.writeHead(401, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ proxied: request.url }));
});
await listen(upstream);

const web = createServer(async (request, response) => {
  const url = request.url ?? '/';
  if (url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }
  if (url.startsWith('/api/')) {
    const target = new URL(request.url ?? '/', `http://127.0.0.1:${address(upstream).port}`);
    const forwarded = await fetch(target, { method: request.method });
    response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' });
    response.end(Buffer.from(await forwarded.arrayBuffer()));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(index);
});
await listen(web);

const base = `http://127.0.0.1:${address(web).port}`;
const health = await fetch(`${base}/health`);
const page = await fetch(`${base}/`);
const proxied = await fetch(`${base}/api/gathering-admin/me`);
const healthText = await health.text();
const pageText = await page.text();
const proxiedBody = await proxied.json();
if (health.status !== 200 || healthText !== 'ok') throw new Error(`health ${health.status} ${healthText}`);
if (page.status !== 200 || !pageText.includes('id="root"')) throw new Error('index를 내려주지 못했습니다.');
if (proxied.status !== 401 || proxiedBody.proxied !== '/api/gathering-admin/me') {
  throw new Error(`proxy ${proxied.status} ${JSON.stringify(proxiedBody)}`);
}
upstream.close();
web.close();
console.log('gathering-admin web smoke ok');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function address(server) {
  const value = server.address();
  if (!value || typeof value === 'string') throw new Error('포트를 열지 못했습니다.');
  return value;
}
