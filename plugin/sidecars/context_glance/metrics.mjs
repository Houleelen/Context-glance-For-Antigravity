import { open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TAIL = 4 * 1024 * 1024;
const MAX_FRAME = 2 * 1024 * 1024;
const MAX_CACHE = 16;

export function resolveAppData(env = process.env) {
  if (env.ANTIGRAVITY_APP_DATA_DIR) return env.ANTIGRAVITY_APP_DATA_DIR;
  if (env.ANTIGRAVITY_EXECUTABLE_DATA_DIR) {
    // Host value: <appData>/sidecar_data/<plugin>/<sidecar>/data. Match the
    // built-in Swarm resolver instead of assuming a fixed parent count.
    let directory = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
    while (dirname(directory) !== directory) {
      if (basename(directory) === 'sidecar_data') return dirname(directory);
      directory = dirname(directory);
    }
    // Do not silently read another profile if the host layout has changed.
    return join(env.ANTIGRAVITY_EXECUTABLE_DATA_DIR, 'unavailable-app-data');
  }
  return join(homedir(), '.gemini', 'antigravity');
}

function integer(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function capacityValue(value) {
  const n = integer(value);
  return n !== null && n >= 1024 && n <= 100_000_000 ? n : null;
}
function dateValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseTranscript(text, { startsMidLine = false } = {}) {
  const lines = text.split('\n');
  if (startsMidLine) lines.shift();
  const records = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // torn append
    if (row.type !== 'PLANNER_RESPONSE') continue;
    const input = integer(row.input_tokens);
    const prompt = integer(row.prompt_tokens);
    if (input === null && prompt === null) continue;
    const cache = integer(row.cache_read_tokens) ?? 0;
    // In this host's transcript input_tokens excludes cached tokens. A future
    // explicit prompt_tokens field is already a total and must not be doubled.
    const used = prompt ?? input + cache;
    if (!Number.isSafeInteger(used)) continue;
    const step = integer(row.step_index);
    const record = {
      inputTokens: input ?? Math.max(0, used - cache),
      cacheReadTokens: cache,
      outputTokens: integer(row.output_tokens) ?? 0,
      promptTokens: used,
      usedTokens: used,
      capacityTokens: capacityValue(row.context_window_size ?? row.max_context_tokens ?? row.context_window?.context_window_size),
      model: typeof row.model_name === 'string' ? row.model_name.slice(0, 120) : null,
      stepIndex: step,
      createdAt: dateValue(row.created_at),
    };
    records.set(step === null ? Symbol() : step, record);
  }
  return [...records.values()].slice(-60);
}

function inside(file, root) {
  const r = relative(root, file);
  return r !== '..' && !r.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(r);
}
async function safeFile(appData, part, id, ...rest) {
  const root = await realpath(join(appData, part));
  const file = await realpath(join(root, id, ...rest));
  if (!inside(file, root)) throw new Error('outside-data-root');
  return file;
}

async function transcriptAt(appData, id, cache) {
  try {
    const file = await safeFile(appData, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    const info = await stat(file);
    if (!info.isFile()) return { history: [], unavailable: true };
    const key = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const hit = cache.get(id);
    if (hit?.key === key) return hit.result;
    const handle = await open(file, 'r');
    let history = [], length = Math.min(info.size, 256 * 1024), position = 0;
    try {
      do {
        position = Math.max(0, info.size - length);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        history = parseTranscript(buffer.subarray(0, bytesRead).toString('utf8'), { startsMidLine: position > 0 });
        if (history.length || position === 0 || length === MAX_TAIL) break;
        length = Math.min(info.size, MAX_TAIL, length * 2);
      } while (true);
    } finally { await handle.close(); }
    const result = { history, logModifiedAt: info.mtime.toISOString(), scanTruncated: position > 0 };
    cache.delete(id);
    cache.set(id, { key, result });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return result;
  } catch (error) {
    // Do not retain old readings after deletion, denied access or rotation.
    cache.delete(id);
    return { history: [], unavailable: !['ENOENT', 'ENOTDIR'].includes(error.code) };
  }
}

function endpoint(env, method = 'StreamAgentStateUpdates') {
  if (!env.ANTIGRAVITY_LS_ADDRESS || !env.ANTIGRAVITY_CSRF_TOKEN) return null;
  try {
    const url = new URL(`http://${env.ANTIGRAVITY_LS_ADDRESS}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/') return null;
    url.pathname = `/exa.language_server_pb.LanguageServerService/${method}`;
    return url;
  } catch { return null; }
}

export async function* connectFrames(response) {
  if (!response.ok || !response.body) throw new Error('native-unavailable');
  const reader = response.body.getReader();
  let pending = Buffer.alloc(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (pending.length) throw new Error('incomplete-native-frame');
        break;
      }
      // Bound buffered bytes even when a peer sends a corrupt frame prefix.
      if (pending.length + value.byteLength > MAX_FRAME + 65536) throw new Error('native-frame-too-large');
      pending = Buffer.concat([pending, value]);
      while (pending.length >= 5) {
        const length = pending.readUInt32BE(1);
        if (length > MAX_FRAME) throw new Error('native-frame-too-large');
        if (pending.length < length + 5) break;
        const flags = pending[0];
        if (flags & 1) throw new Error('compressed-native-frame');
        const data = JSON.parse(pending.subarray(5, 5 + length).toString('utf8'));
        pending = pending.subarray(5 + length);
        if (flags & 2) {
          if (data.error) throw new Error('native-stream-error');
          return;
        }
        yield data;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function nativeUsage(context) {
  if (!context || typeof context !== 'object') return null;
  const used = integer(context.estimatedTokensUsed ?? 0);
  const capacity = capacityValue(context.maxContextTokens);
  if (used === null || capacity === null) return null;
  return {
    usedTokens: used, capacityTokens: capacity,
    stepIndex: integer(context.lastStepIndex),
    index: integer(context.generatorMetadataIndex),
    nativeEstimate: true,
  };
}

function modelText(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160) : '';
}

export function modelFromMetadata(rows) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const chat = rows[i]?.chatModel;
    const id = modelText(chat?.responseModel);
    const name = modelText(chat?.modelDisplayName) || id;
    if (name) return { name, id: id || null, source: 'request' };
  }
  return null;
}

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error('model-unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FRAME) throw new Error('model-metadata-too-large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createModelReader(env, fetchImpl) {
  const url = endpoint(env, 'GetCascadeTrajectoryGeneratorMetadata');
  const cache = new Map();
  const controllers = new Set();
  const read = async (id, index) => {
    if (!url || !fetchImpl || integer(index) === null) return null;
    let state = cache.get(id);
    if (!state) {
      state = {};
      cache.set(id, state);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    if (state.pending) return state.pending;
    if (state.index === index && state.model) return state.model;
    if (state.attemptIndex === index && Date.now() - (state.checkedAt ?? 0) < 3000) return state.model ?? null;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 2000);
    timeout.unref?.();
    state.pending = (async () => {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': env.ANTIGRAVITY_CSRF_TOKEN },
          body: JSON.stringify({ cascadeId: id, generatorMetadataOffset: index, includeMessages: false }),
          signal: controller.signal,
        });
        const data = await boundedJson(response);
        // Read only the last request's model identity. Other returned metadata
        // is discarded; nothing is written to the conversation or sent to AI.
        const model = modelFromMetadata(data.generatorMetadata);
        if (model) {
          state.model = model;
          state.index = index;
        }
        return state.model ?? null;
      } catch { return state.model ?? null; }
      finally {
        state.attemptIndex = index;
        state.checkedAt = Date.now();
        state.pending = null;
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    })();
    return state.pending;
  };
  read.close = () => {
    for (const controller of controllers) controller.abort();
    cache.clear();
  };
  return read;
}

function createNativeReader(env, fetchImpl) {
  const url = endpoint(env);
  const cache = new Map();
  function stop(state) {
    clearTimeout(state.idleTimer);
    state.intentionalStop = true;
    state.controller?.abort();
    state.result = null;
  }
  const read = async (id) => {
    if (!url || !fetchImpl) return null;
    let state = cache.get(id);
    if (!state) {
      state = { history: [] };
      cache.set(id, state);
      if (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        stop(cache.get(oldest));
        cache.delete(oldest);
      }
    }
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => stop(state), 12000);
    state.idleTimer.unref?.();
    if (state.initial) return state.initial;
    if (state.connected) return state.result;
    if (Date.now() - (state.failedAt ?? 0) < 15000) return null;

    const controller = new AbortController();
    state.intentionalStop = false;
    state.controller = controller;
    const initialTimeout = setTimeout(() => controller.abort(), 3500);
    initialTimeout.unref?.();
    let resolveInitial;
    state.initial = new Promise((resolve) => { resolveInitial = resolve; });
    const initial = state.initial;
    state.connected = true;
    const body = Buffer.from(JSON.stringify({
      conversationId: id,
      subscriberId: `context-glance-${randomUUID()}`,
      initialStepsPageBounds: { startIndex: 0, endIndexExclusive: 0 },
      initialGeneratorMetadatasPageBounds: { startIndex: 0, endIndexExclusive: 0 },
      initialExecutorMetadatasPageBounds: { startIndex: 0, endIndexExclusive: 0 },
      disableRehydration: true,
    }));
    const frame = Buffer.alloc(5);
    frame.writeUInt32BE(body.length, 1);
    // This task only consumes state updates. It never sends a chat message,
    // changes permissions, retrieves message bodies, or invokes a model.
    state.task = (async () => {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/connect+json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': env.ANTIGRAVITY_CSRF_TOKEN },
          body: Buffer.concat([frame, body]),
          signal: controller.signal,
        });
        for await (const data of connectFrames(res)) {
          const result = nativeUsage(data.update?.contextWindowUsage);
          if (!result) continue;
          const signature = `${result.index}:${result.stepIndex}:${result.usedTokens}:${result.capacityTokens}`;
          if (signature !== state.signature) {
            state.signature = signature;
            state.updatedAt = new Date().toISOString();
            state.history.push({ stepIndex: result.stepIndex, usedTokens: result.usedTokens, createdAt: state.updatedAt });
            state.history = state.history.slice(-60);
          }
          state.result = { ...result, updatedAt: state.updatedAt, history: [...state.history] };
          clearTimeout(initialTimeout);
          resolveInitial(state.result);
          state.initial = null;
        }
      } catch {
        if (!controller.signal.aborted) state.failedAt = Date.now();
      } finally {
        clearTimeout(initialTimeout);
        if (!state.result && controller.signal.aborted && !state.intentionalStop) state.failedAt = Date.now();
        state.connected = false;
        state.result = null;
        resolveInitial(null);
        state.initial = null;
      }
    })();
    return initial;
  };
  read.close = async () => {
    for (const state of cache.values()) stop(state);
    await Promise.allSettled([...cache.values()].map((state) => state.task));
    cache.clear();
  };
  return read;
}

export function createSnapshotReader({ appData = resolveAppData(), env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const transcriptCache = new Map();
  const nativeAt = createNativeReader(env, fetchImpl);
  const modelAt = createModelReader(env, fetchImpl);
  const read = async ({ conversationId = '', capacity } = {}) => {
    const base = { conversationId, status: 'waiting', updatedAt: null, logModifiedAt: null, metrics: null, currentModel: null, history: [], source: 'transcript', scanTruncated: false };
    if (!conversationId) return { ...base, status: 'no-conversation', message: '请从一个会话中打开仪表盘。' };
    if (typeof conversationId !== 'string' || !ID_RE.test(conversationId)) return { ...base, status: 'invalid-conversation', message: '会话标识无效。' };
    const [log, native] = await Promise.all([transcriptAt(appData, conversationId, transcriptCache), nativeAt(conversationId)]);
    const latest = log.history.at(-1);
    const currentModel = await modelAt(conversationId, native?.index)
      ?? (latest?.model ? { name: latest.model, id: null, source: 'log' } : null);
    if (!latest && !native) return { ...base, status: log.unavailable ? 'unavailable' : 'waiting', message: log.unavailable ? '暂时无法读取此会话的用量。' : '等待此会话产生用量记录。', logModifiedAt: log.logModifiedAt ?? null, scanTruncated: log.scanTruncated ?? false };
    const manual = capacityValue(capacity);
    const maximum = manual ?? native?.capacityTokens ?? latest?.capacityTokens ?? null;
    const used = native?.usedTokens ?? latest.usedTokens;
    const prompt = latest?.promptTokens ?? null;
    return {
      ...base, status: 'ok', source: native ? 'native-context' : 'transcript', currentModel,
      updatedAt: native?.updatedAt ?? latest?.createdAt ?? log.logModifiedAt ?? null,
      logModifiedAt: log.logModifiedAt ?? null,
      scanTruncated: log.scanTruncated ?? false,
      metrics: {
        inputTokens: latest?.inputTokens ?? null, cacheReadTokens: latest?.cacheReadTokens ?? null,
        outputTokens: latest?.outputTokens ?? null, promptTokens: prompt,
        usedTokens: used, capacityTokens: maximum,
        capacitySource: manual ? 'manual' : native ? 'native' : maximum ? 'log' : 'unknown',
        nativeEstimate: Boolean(native), percent: maximum ? used * 100 / maximum : null,
        stepIndex: native?.stepIndex ?? latest?.stepIndex ?? null, model: currentModel?.name ?? latest?.model ?? null,
        cachePercent: prompt > 0 ? latest.cacheReadTokens * 100 / prompt : null,
      },
      history: native?.history ?? log.history.map(({ stepIndex, usedTokens, createdAt }) => ({ stepIndex, usedTokens, createdAt })),
    };
  };
  read.close = async () => { modelAt.close(); await nativeAt.close(); };
  return read;
}
