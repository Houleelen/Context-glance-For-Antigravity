import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { createSnapshotReader, resolveAppData } from './metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = new SidecarApp();
const snapshot = createSnapshotReader({ appData: resolveAppData(), env: process.env });
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
};
const response = (body, contentType, status = 200) => new Response(body, { contentType, status, headers });

// SDK supplies these system routes. Replace their implementations BEFORE run()
// starts listening, so no route can start a conversation or send a message.
app.sendMessage = () => response('{"error":"read-only sidecar"}', 'application/json', 403);
app.startConversation = app.sendMessage;
// preload.js asks for metadata to resolve workspaces. This panel does not need
// workspace access, so return an empty result without spawning any CLI process.
app.getConversationMetadata = () => ({ response: { conversationMetadata: {} } });

for (const [route, file, contentType] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/dashboard.js', 'dashboard.js', 'application/javascript; charset=utf-8'],
  ['/i18n.js', 'i18n.js', 'application/javascript; charset=utf-8'],
]) {
  const content = await readFile(join(here, file), 'utf8');
  app.api(route, () => response(content, contentType), 'GET');
}
app.api('/api/snapshot', async (query) => {
  const data = await snapshot({
    // An explicit blank ID means no selected conversation. Never guess the most
    // recently modified conversation, or reuse another panel's environment ID.
    conversationId: query.conversationId ?? '',
    capacity: query.capacity,
  });
  return response(JSON.stringify(data), 'application/json; charset=utf-8');
}, 'GET');

await app.run();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await snapshot.close(); await app.close(); process.exit(0); });
}
