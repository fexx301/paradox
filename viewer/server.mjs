// Minimal static server so CreateOS can host the viewer: every path returns index.html.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./index.html', import.meta.url));
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(page);
}).listen(Number(process.env.PORT) || 8080);
