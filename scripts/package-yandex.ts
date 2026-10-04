import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { zipSync } from 'fflate';

// Drafts are intentionally marked: their localhost endpoint is not uploadable.
const draft = process.argv.includes('--draft');
const endpoint = process.env.VITE_SERVER_URL;
if (!draft) {
  if (!endpoint) throw new Error('Задайте VITE_SERVER_URL=wss://ваш-домен/socket. Без публичного сервера возможна только release:draft.');
  const url = new URL(endpoint);
  if (url.protocol !== 'wss:' || url.pathname !== '/socket' || url.search || url.hash || url.username || url.password || url.port || isIP(url.hostname) || !url.hostname.includes('.') || /(^localhost$|\.(example|invalid|test|localhost)$|(^|\.)example\.(com|net|org)$)/.test(url.hostname)) throw new Error('Нужен публичный WSS-домен без порта, учётных данных и параметров, с путём /socket.');
}
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {stdio: 'inherit'});
if (result.status !== 0) process.exit(result.status ?? 1);
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit', env: {...process.env, BIPLANES_RELEASE: '1', VITE_YANDEX_RELEASE: '1', VITE_SERVER_URL: draft ? 'ws://127.0.0.1:5187/socket' : endpoint},
});
if (build.status !== 0) process.exit(build.status ?? 1);
const files: Record<string, Uint8Array> = {};
async function collect(dir: string) {
  for (const item of await readdir(dir, {withFileTypes: true})) {
    const path = resolve(dir, item.name), name = relative(resolve('dist'), path).replaceAll('\\', '/');
    if (item.isDirectory()) { await collect(path); continue; }
    // Exclude source prompts, legacy art and development galleries.
    if (!(name === 'index.html' || name.startsWith('assets/') || name.startsWith('audio/') || (name.startsWith('art/approved/') || name.startsWith('art/pvo/')) && name.endsWith('.png'))) continue;
    if (!/^[a-zA-Z0-9_./-]+$/.test(name)) throw new Error('Недопустимое имя файла: ' + name);
    files[name] = await readFile(path);
  }
}
await collect(resolve('dist'));
const total = Object.values(files).reduce((sum, file) => sum + file.length, 0);
if (!files['index.html'] || total > 100 * 1024 * 1024) throw new Error('Неверная структура архива или превышен лимит 100 МБ.');
await mkdir('release', {recursive: true});
const filename = 'release/biplanes-yandex' + (draft ? '-LOCAL-DRAFT' : '') + '.zip';
await writeFile(filename, zipSync(files, {level: 6}));
await writeFile(filename + '.json', JSON.stringify({draft, uploadable: !draft, endpoint: draft ? 'LOCAL ONLY' : endpoint, unpackedBytes: total, files: Object.keys(files), consoleVerified: false}, null, 2));
console.log(`${filename}: ${Object.keys(files).length} файлов, ${(total / 1024 / 1024).toFixed(2)} МБ до сжатия. ${draft ? 'НЕ ЗАГРУЖАТЬ: локальный черновик.' : 'Перед модерацией проверьте в консоли Яндекса.'}`);
