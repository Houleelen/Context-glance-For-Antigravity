import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capacityValue, connectFrames, createSnapshotReader, modelFromMetadata, nativeUsage, parseTranscript, resolveAppData } from '../plugin/sidecars/context_glance/metrics.mjs';

const ID = '00000000-0000-4000-a000-000000000001';
const OTHER = '00000000-0000-4000-a000-000000000002';
const record = (step, input = 100, cache = 900) => ({ type: 'PLANNER_RESPONSE', step_index: step, input_tokens: input, cache_read_tokens: cache, output_tokens: 50, created_at: '2026-11-12T09:00:00Z' });
function frame(value, flags = 0) {
  const body = Buffer.from(JSON.stringify(value));
  const prefix = Buffer.alloc(5);
  prefix[0] = flags;
  prefix.writeUInt32BE(body.length, 1);
  return Buffer.concat([prefix, body]);
}
async function fixture(t) {
  const base = fileURLToPath(new URL('../.verification/', import.meta.url));
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'metrics-'));
  assert.ok(root.startsWith(base));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'brain', ID, '.system_generated', 'logs');
  await mkdir(dir, { recursive: true });
  return { root, file: join(dir, 'transcript.jsonl') };
}

test('缓存计入输入，不累计历史和输出；同一步以最后记录为准', () => {
  const lines = [record(1, 1000), record(2), { type: 'TOOL_RESULT', input_tokens: 999999 }, record(2, 200)];
  const rows = parseTranscript(lines.map(JSON.stringify).join('\n') + '\n{"type":');
  assert.equal(rows.length, 2);
  assert.equal(rows.at(-1).usedTokens, 1100);
  assert.equal(rows.at(-1).outputTokens, 50);
  assert.equal(rows.at(-1).promptTokens, 1100);
});

test('明确prompt总量不重复加缓存；拒绝负数和不安全整数', () => {
  const values = [{ ...record(1), prompt_tokens: 1000 }, record(2, -1), record(3, Number.MAX_SAFE_INTEGER)];
  assert.deepEqual(parseTranscript(values.map(JSON.stringify).join('\n')).map(x => x.usedTokens), [1000]);
  assert.equal(capacityValue('256000'), 256000);
  assert.equal(capacityValue('Infinity'), null);
  assert.equal(capacityValue(0), null);
});

test('按宿主sidecar_data目录解析profile，不跨profile猜路径', () => {
  const root = join(tmpdir(), 'a-profile');
  assert.equal(resolveAppData({ ANTIGRAVITY_EXECUTABLE_DATA_DIR: join(root, 'sidecar_data', 'context-glance', 'context_glance', 'data') }), root);
  assert.equal(resolveAppData({ ANTIGRAVITY_APP_DATA_DIR: root }), root);
  assert.notEqual(resolveAppData({ ANTIGRAVITY_EXECUTABLE_DATA_DIR: join(root, 'other') }), root);
});

test('日志刷新、半行追加、截断和会话隔离', async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, JSON.stringify(record(1)) + '\n');
  const read = createSnapshotReader({ appData: root, env: {} });
  t.after(() => read.close());
  let s = await read({ conversationId: ID });
  assert.equal(s.metrics.usedTokens, 1000);
  assert.equal(s.metrics.percent, null);
  assert.equal(s.metrics.capacitySource, 'unknown');
  await appendFile(file, JSON.stringify(record(2, 2000)) + '\n{"type":"PLAN');
  s = await read({ conversationId: ID, capacity: '256000' });
  assert.equal(s.metrics.usedTokens, 2900);
  assert.equal(s.metrics.percent, 2900 / 256000 * 100);
  assert.equal(s.metrics.capacitySource, 'manual');
  assert.equal((await read({ conversationId: OTHER })).metrics, null);
  assert.equal((await read({ conversationId: '' })).status, 'no-conversation');
  assert.equal((await read({ conversationId: '../' + ID })).status, 'invalid-conversation');
  await writeFile(file, '');
  assert.equal((await read({ conversationId: ID })).metrics, null);
});

test('中途截取不解析首个残行，超长行尾部不伪造用量', async t => {
  const { root, file } = await fixture(t);
  assert.equal(parseTranscript(JSON.stringify(record(1)) + '\n' + JSON.stringify(record(2)), { startsMidLine: true }).length, 1);
  await writeFile(file, 'x'.repeat(300000) + '\n' + JSON.stringify(record(7)));
  const read = createSnapshotReader({ appData: root, env: {} });
  t.after(() => read.close());
  const s = await read({ conversationId: ID });
  assert.equal(s.metrics.stepIndex, 7);
  assert.equal(s.scanTruncated, true);
});

test('Connect帧支持跨chunk、多个帧和正常结束', async () => {
  const bytes = Buffer.concat([frame({ update: { contextWindowUsage: { estimatedTokensUsed: 12 } } }), frame({ update: {} }), frame({}, 2)]);
  const chunks = [bytes.subarray(0, 3), bytes.subarray(3, 28), bytes.subarray(28)];
  const response = new Response(new ReadableStream({ start(c) { for (const b of chunks) c.enqueue(b); c.close(); } }));
  const values = [];
  for await (const value of connectFrames(response)) values.push(value);
  assert.equal(values.length, 2);
  assert.equal(values[0].update.contextWindowUsage.estimatedTokensUsed, 12);
});

test('拒绝过大、压缩、截断及错误Connect帧', async () => {
  const tooLarge = Buffer.alloc(5);
  tooLarge.writeUInt32BE(3 * 1024 * 1024, 1);
  for (const bytes of [tooLarge, frame({}, 1), frame({ error: { message: 'denied' } }, 2), Buffer.from([0, 0])]) {
    await assert.rejects(async () => { for await (const _ of connectFrames(new Response(bytes))) {} });
  }
});

test('原生宿主容量和值直接使用，允许零用量，拒绝不完整容量', () => {
  assert.equal(nativeUsage({ estimatedTokensUsed: 142903, maxContextTokens: 256000 }).usedTokens, 142903);
  assert.equal(nativeUsage({ maxContextTokens: 256000 }).usedTokens, 0);
  assert.equal(nativeUsage({ estimatedTokensUsed: 1200 }), null);
});

test('模型来自实际请求元数据，优先展示名并保留ID，不猜模型目录默认值', () => {
  assert.deepEqual(modelFromMetadata([{ chatModel: { modelDisplayName: 'Gemini 3.8 Flash (High)', responseModel: 'gemini-3.8-flash-n' } }]), {
    name: 'Gemini 3.8 Flash (High)', id: 'gemini-3.8-flash-n', source: 'request',
  });
  assert.equal(modelFromMetadata([{ chatModel: { responseModel: 'specific-model-id' } }]).name, 'specific-model-id');
  assert.equal(modelFromMetadata([{ plannerConfig: { modelName: 'not-a-recorded-response' } }]), null);
  assert.equal(modelFromMetadata([]), null);
});

test('复用只读状态订阅，原生上下文与日志请求明细分开，退出取消订阅', async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, JSON.stringify(record(1)) + '\n');
  let calls = 0, streamController, cancelled = false;
  const env = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1234', ANTIGRAVITY_CSRF_TOKEN: 'test-only-token' };
  const read = createSnapshotReader({ appData: root, env, fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/GetCascadeTrajectoryGeneratorMetadata')) return new Response('{}', { status: 403 });
    calls++;
    assert.ok(url.pathname.endsWith('/StreamAgentStateUpdates'));
    const request = JSON.parse(options.body.subarray(5));
    assert.equal(request.conversationId, ID);
    assert.equal(request.initialStepsPageBounds.endIndexExclusive, 0);
    assert.equal(request.disableRehydration, true);
    return new Response(new ReadableStream({
      start(c) {
        streamController = c;
        c.enqueue(frame({ update: { contextWindowUsage: { estimatedTokensUsed: 142903, maxContextTokens: 256000, lastStepIndex: 12, generatorMetadataIndex: 7 } } }));
        options.signal.addEventListener('abort', () => { cancelled = true; c.error(new Error('aborted')); }, { once: true });
      },
    }));
  } });
  t.after(() => read.close());
  let s = await read({ conversationId: ID });
  assert.equal(s.source, 'native-context');
  assert.equal(s.metrics.usedTokens, 142903);
  assert.equal(s.metrics.capacityTokens, 256000);
  assert.equal(s.metrics.promptTokens, 1000);
  assert.equal(s.metrics.capacitySource, 'native');
  assert.equal(s.currentModel, null); // denied model metadata must not break usage
  streamController.enqueue(frame({ update: { contextWindowUsage: { estimatedTokensUsed: 145000, maxContextTokens: 256000, lastStepIndex: 13, generatorMetadataIndex: 8 } } }));
  await new Promise(resolve => setImmediate(resolve));
  s = await read({ conversationId: ID, capacity: '200000' });
  assert.equal(s.metrics.percent, 72.5);
  assert.equal(s.metrics.capacitySource, 'manual');
  assert.equal(s.history.length, 2);
  assert.equal(calls, 1);
  await read.close();
  assert.equal(cancelled, true);
});

test('按当前会话和请求索引读取模型，只在新请求后刷新并隔离其他会话', async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, JSON.stringify(record(1)));
  let streamController;
  const modelRequests = [];
  const env = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1234', ANTIGRAVITY_CSRF_TOKEN: 'test-only-token' };
  const read = createSnapshotReader({ appData: root, env, fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/GetCascadeTrajectoryGeneratorMetadata')) {
      const query = JSON.parse(options.body);
      modelRequests.push(query);
      assert.equal(query.cascadeId, ID);
      assert.equal(query.includeMessages, false);
      return Response.json({ generatorMetadata: [{ chatModel: query.generatorMetadataOffset === 7
        ? { modelDisplayName: 'Gemini 3.8 Flash (High)', responseModel: 'gemini-3.8-flash-n' }
        : { modelDisplayName: 'Gemini 4 Argon', responseModel: 'gemini-4-argon' } }] });
    }
    const query = JSON.parse(options.body.subarray(5));
    if (query.conversationId !== ID) return new Response('{}', { status: 403 });
    return new Response(new ReadableStream({ start(c) {
      streamController = c;
      c.enqueue(frame({ update: { contextWindowUsage: { estimatedTokensUsed: 140000, maxContextTokens: 256000, generatorMetadataIndex: 7 } } }));
      options.signal.addEventListener('abort', () => c.error(new Error('aborted')), { once: true });
    } }));
  } });
  t.after(() => read.close());
  let s = await read({ conversationId: ID });
  assert.equal(s.currentModel.name, 'Gemini 3.8 Flash (High)');
  assert.equal(s.currentModel.id, 'gemini-3.8-flash-n');
  assert.equal(s.currentModel.source, 'request');
  await read({ conversationId: ID });
  assert.equal(modelRequests.length, 1);
  assert.equal((await read({ conversationId: OTHER })).currentModel, null);
  streamController.enqueue(frame({ update: { contextWindowUsage: { estimatedTokensUsed: 141000, maxContextTokens: 256000, generatorMetadataIndex: 8 } } }));
  await new Promise(resolve => setImmediate(resolve));
  s = await read({ conversationId: ID });
  assert.equal(s.currentModel.name, 'Gemini 4 Argon');
  assert.equal(modelRequests.length, 2);
  assert.equal(modelRequests[1].generatorMetadataOffset, 8);
});

test('状态接口拒绝时自动降级，并限制重试；不访问远程地址', async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, JSON.stringify(record(1)));
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 403 }); };
  const env = { ANTIGRAVITY_LS_ADDRESS: 'localhost:1234', ANTIGRAVITY_CSRF_TOKEN: 'test-only-token' };
  const read = createSnapshotReader({ appData: root, env, fetchImpl });
  t.after(() => read.close());
  assert.equal((await read({ conversationId: ID })).source, 'transcript');
  assert.equal((await read({ conversationId: ID })).metrics.percent, null);
  assert.equal(calls, 1);
  const remote = createSnapshotReader({ appData: root, env: { ...env, ANTIGRAVITY_LS_ADDRESS: 'example.com:80' }, fetchImpl });
  t.after(() => remote.close());
  assert.equal((await remote({ conversationId: ID })).source, 'transcript');
  assert.equal(calls, 1);
});
