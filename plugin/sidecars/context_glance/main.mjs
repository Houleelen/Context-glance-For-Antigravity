import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { createSnapshotReader, resolveAppData } from './metrics.mjs';
import { createHostLivenessMonitor, createShutdownHandler } from './lifecycle.mjs';

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

const server = await app.run();
let hostMonitor;
const terminate = createShutdownHandler({
  closeReaders: () => snapshot.close(),
  closeServer: () => app.close(),
  forceCloseConnections: () => server.closeAllConnections?.(),
  exit: code => process.exit(code),
  timeoutMs: 3000,
});
const shutdown = (reason) => {
  hostMonitor?.stop();
  console.log(`[context-glance] stopping: ${reason}`);
  return terminate(reason);
};
// Windows may terminate the LS without forwarding a signal to its Sidecars.
// Monitor only this injected loopback endpoint and exit only our own process.
try {
  hostMonitor = createHostLivenessMonitor({
    address: process.env.ANTIGRAVITY_LS_ADDRESS,
    onHostGone: () => shutdown('host-disconnected'),
  });
  hostMonitor.start();
} catch {
  console.warn('[context-glance] host monitoring disabled: invalid loopback address');
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown(signal); });
}
