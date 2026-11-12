import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const loader = process.env.CONTEXT_GLANCE_TEST_SDK_LOADER || join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'register_loader.js');

test('宿主SDK集成：页面与快照可读；发送和新建对话接口返回403', { skip: !existsSync(loader), timeout: 15000 }, async t => {
  const main = fileURLToPath(new URL('../plugin/sidecars/context_glance/main.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', pathToFileURL(loader).href, main], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1', ANTIGRAVITY_CSRF_TOKEN: 'integration-test-only', ANTIGRAVITY_SIDECAR_WEB_PORT: '0', ANTIGRAVITY_SIDECAR_UI_TOKEN: 'integration-test-ui-only' },
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exit;
    }
  });
  let stderr = '';
  child.stderr.on('data', b => { stderr += b.toString(); });
  const port = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('SDK start timed out: ' + stderr)), 6000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`SDK exited ${code}: ${stderr}`)); });
    child.stdout.on('data', b => {
      text += b.toString();
      const match = text.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  for (const route of ['/', '/styles.css', '/dashboard.js', '/i18n.js', '/preload.js']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 100);
  }
  const response = await fetch(base + '/api/snapshot?conversationId=');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).status, 'no-conversation');
  assert.equal((await fetch(base + '/api/snapshot?conversationId=..%2fsecret')).status, 200);
  assert.equal((await (await fetch(base + '/api/snapshot?conversationId=..%2fsecret')).json()).status, 'invalid-conversation');
  for (const route of ['send-message', 'new-conversation']) {
    const response = await fetch(base + '/_sidecar/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sidecar-Token': 'integration-test-ui-only' },
      body: JSON.stringify({ message: 'test payload must never be sent' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'read-only sidecar');
  }
  assert.equal((await fetch(base + '/_sidecar/send-message', { method: 'POST', body: '{}' })).status, 401);
});
