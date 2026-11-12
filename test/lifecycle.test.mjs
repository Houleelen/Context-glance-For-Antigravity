import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostLivenessMonitor, createShutdownHandler } from '../plugin/sidecars/context_glance/lifecycle.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const response = (status = 200, cancel = () => Promise.resolve()) => ({ status, body: { cancel } });
function monitor(t, options) {
  const instance = createHostLivenessMonitor({
    address: 'localhost:5387', onHostGone: () => {}, intervalMs: 60000,
    timeoutMs: 1000, graceMs: 0, ...options,
  });
  t.after(() => instance.stop());
  instance.start();
  return instance;
}

test('生命周期探测拒绝远程地址、重定向目标和带路径的地址', () => {
  for (const address of ['example.com:5387', 'https://localhost:5387', 'http://user@localhost:5387', 'localhost:5387/private', 'localhost:5387?x=1', 'localhost:5387#x', '', 'file:///tmp/a']) {
    assert.throws(() => createHostLivenessMonitor({ address, onHostGone() {} }), TypeError);
  }
});

test('任意HTTP状态均视为存活，探测仅访问回环healthz并丢弃响应体', async t => {
  const statuses = [200, 404, 503, 302];
  let cancelled = 0, notified = 0;
  const instance = monitor(t, { onHostGone: () => { notified++; }, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://localhost:5387/healthz');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers, undefined);
    return response(statuses.shift(), () => { cancelled++; return Promise.reject(new Error('ignored cancel error')); });
  } });
  for (let i = 0; i < 4; i++) assert.deepEqual(await instance.checkNow(), { alive: true, failures: 0 });
  await turn();
  assert.equal(cancelled, 4);
  assert.equal(notified, 0);
});

test('存活响应重置连续失败次数，只有连续三次失败才通知且只通知一次', async t => {
  const outcomes = [false, false, true, false, false, false];
  let notified = 0, calls = 0;
  const instance = monitor(t, { onHostGone: () => { notified++; }, fetchImpl: async () => {
    calls++;
    if (!outcomes.shift()) throw new Error('connection refused');
    return response();
  } });
  for (let i = 0; i < 5; i++) {
    await instance.checkNow();
    assert.equal(notified, 0);
  }
  assert.equal((await instance.checkNow()).hostGone, true);
  assert.equal(notified, 1);
  await instance.checkNow();
  assert.equal(calls, 6);
  assert.equal(notified, 1);
});

test('启动宽限期内即使多次连接失败也不退出', async t => {
  let time = 0, notified = 0;
  const instance = monitor(t, { graceMs: 15000, now: () => time, onHostGone: () => { notified++; }, fetchImpl: async () => { throw new Error('offline'); } });
  for (let i = 0; i < 3; i++) await instance.checkNow();
  assert.equal(notified, 0);
  time = 14999;
  await instance.checkNow();
  assert.equal(notified, 0);
  time = 15000;
  await instance.checkNow();
  assert.equal(notified, 1);
});

test('同时触发探测会复用同一请求，不发生并发重入', async t => {
  let calls = 0, resolveResponse;
  const instance = monitor(t, { fetchImpl: () => {
    calls++;
    return new Promise(resolve => { resolveResponse = resolve; });
  } });
  const first = instance.checkNow();
  const second = instance.checkNow();
  assert.equal(first, second);
  await turn();
  assert.equal(calls, 1);
  resolveResponse(response(500));
  assert.equal((await first).alive, true);
});

test('stop取消当前探测并停止调度，不将主动取消算作宿主失联', async t => {
  let calls = 0, aborted = false, notified = 0;
  const instance = monitor(t, { failureThreshold: 1, onHostGone: () => { notified++; }, fetchImpl: (url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    });
  } });
  const pending = instance.checkNow();
  await turn();
  instance.stop();
  assert.equal((await pending).stopped, true);
  assert.equal(aborted, true);
  assert.equal(notified, 0);
  await instance.checkNow();
  instance.start();
  assert.equal(calls, 1);
});

test('连接超时计为失败，回调异常不会产生未处理拒绝', async t => {
  let notified = 0;
  const instance = monitor(t, { timeoutMs: 5, failureThreshold: 1, onHostGone: () => {
    notified++;
    return Promise.reject(new Error('callback error'));
  }, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  }) });
  assert.equal((await instance.checkNow()).hostGone, true);
  await turn();
  assert.equal(notified, 1);
});

test('统一退出幂等，先停止接收HTTP再关闭读取，正常完成只退出一次', async () => {
  const calls = [];
  const shutdown = createShutdownHandler({
    closeServer: () => { calls.push('server'); },
    closeReaders: () => { calls.push('readers'); },
    forceCloseConnections: () => { calls.push('force'); },
    exit: code => { calls.push(`exit:${code}`); },
    timeoutMs: 1000,
  });
  const first = shutdown('SIGTERM');
  assert.equal(shutdown('again'), first);
  assert.deepEqual(await first, { reason: 'SIGTERM', forced: false });
  assert.deepEqual(calls, ['server', 'readers', 'exit:0']);
});

test('退出清理抛错仍能结束，不阻断其他清理操作', async () => {
  let exited = 0, readersClosed = 0;
  const shutdown = createShutdownHandler({
    closeServer: () => { throw new Error('close failed'); },
    closeReaders: () => { readersClosed++; },
    exit: () => { exited++; },
    timeoutMs: 1000,
  });
  assert.equal((await shutdown()).forced, false);
  assert.equal(exited, 1);
  assert.equal(readersClosed, 1);
});

test('清理悬挂时到达硬期限会强制关连接，并确保退出只执行一次', async () => {
  const calls = [];
  const shutdown = createShutdownHandler({
    closeServer: () => { calls.push('server'); return new Promise(() => {}); },
    closeReaders: () => { calls.push('readers'); return new Promise(() => {}); },
    forceCloseConnections: () => { calls.push('force'); throw new Error('ignored'); },
    exit: () => { calls.push('exit'); },
    timeoutMs: 5,
  });
  assert.equal((await shutdown('host-gone')).forced, true);
  await shutdown('again');
  assert.deepEqual(calls, ['server', 'readers', 'force', 'exit']);
});
