// Offline source/package checks; this does not replace `agy plugin validate`.
import assert from 'node:assert/strict';
import { readFile, lstat, realpath, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = async file => readFile(resolve(root, file), 'utf8');
const json = async file => JSON.parse(await text(file));
const files = await json('scripts/release-files.json');
assert.ok(Array.isArray(files) && files.length > 8, 'Missing publish file list');
assert.equal(new Set(files).size, files.length, 'Duplicate publish file');
const realRoot = await realpath(root);
const texts = new Map();
for (const file of files) {
  assert.equal(typeof file, 'string');
  assert.ok(!isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), `Unsafe publish path: ${file}`);
  assert.ok(!file.split('/').some(part => ['.git', '.verification', 'node_modules', 'dist'].includes(part)), `Private/development path: ${file}`);
  const full = resolve(root, file);
  const actual = await realpath(full);
  const rel = relative(realRoot, actual);
  assert.ok(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep), `Path outside project: ${file}`);
  assert.ok((await lstat(full)).isFile(), `Not a regular file: ${file}`);
  let parent = full;
  while (parent !== resolve(root)) {
    assert.ok(!(await lstat(parent)).isSymbolicLink(), `Symbolic link in publish path: ${file}`);
    const next = dirname(parent);
    assert.notEqual(next, parent);
    parent = next;
  }
  if (!file.endsWith('.png')) texts.set(file, await text(file));
}
const manifest = await json('plugin/plugin.json');
for (const field of ['name', 'displayName', 'description', 'version', 'logo', 'author', 'repository', 'homepage']) {
  assert.ok(typeof manifest[field] === 'string' && manifest[field].trim(), `Missing manifest field: ${field}`);
}
assert.equal(manifest.name, 'context-glance');
assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(Object.hasOwn(manifest, 'license'), false, 'No open-source license should be declared');
assert.equal((await json('package.json')).license, 'UNLICENSED');
assert.equal(manifest.author, 'houleelen');
for (const field of ['repository', 'homepage']) assert.equal(new URL(manifest[field]).protocol, 'https:');
assert.equal(manifest.logo, 'assets/logo.svg');
await access(resolve(root, 'plugin', manifest.logo));
for (const file of ['LICENSE', 'plugin/LICENSE']) {
  const exists = await lstat(resolve(root, file)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  assert.equal(exists, false, `Unexpected license grant: ${file}`);
}
assert.equal((await json('package.json')).version, manifest.version);
const sidecar = await json('plugin/sidecars/context_glance/sidecar.json');
assert.equal(sidecar.env.CONTEXT_GLANCE_UI_VERSION, manifest.version);
assert.equal(sidecar.has_web_ui, true);
assert.equal(sidecar.agent_permissions.allows_user_interactions, false);
assert.ok(sidecar.ui_config.views.some(view => view.entrypoint === 'SIDECAR_UI_ENTRYPOINT_AUX_PANE'));
for (const forbidden of ['hooks.json', 'mcp_config.json', 'skills', 'rules', 'agents']) {
  const exists = await lstat(resolve(root, 'plugin', forbidden)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  assert.equal(exists, false, `Unexpected agent-context component: ${forbidden}`);
}
// Check relative Markdown links before packing; external URLs are metadata only.
for (const [file, content] of texts) {
  assert.ok(!/[a-z]:[\\/]Users[\\/][^\s\\/]+[\\/]|\/Users\/[^/\s]+\//i.test(content), `Personal user-directory path: ${file}`);
  if (!file.endsWith('.md')) continue;
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const linked = resolve(dirname(resolve(root, file)), decodeURIComponent(target));
    await access(linked).catch(() => { throw new Error(`Broken documentation link: ${file} -> ${target}`); });
  }
}
for (const file of files.filter(file => /\.(?:mjs|js)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `JavaScript syntax: ${file}\n${result.stderr}`);
}
console.log(JSON.stringify({
  status: 'passed', version: manifest.version, author: manifest.author,
  license: 'none (UNLICENSED)', publishFiles: files.length,
  repository: manifest.repository,
  officialStrictValidation: 'not-run; run agy plugin validate --strict ./plugin separately',
}, null, 2));
