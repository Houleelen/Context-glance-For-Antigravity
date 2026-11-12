// Own-process lifecycle safeguards. No process enumeration, external writes,
// model RPCs, or termination of other processes is performed here.

function healthUrl(address) {
  if (typeof address !== 'string' || !address.trim() || /[\s\\]/.test(address.trim())) {
    throw new TypeError('A loopback language-server address is required');
  }
  let url;
  try { url = new URL(address.includes('://') ? address.trim() : `http://${address.trim()}`); }
  catch { throw new TypeError('Invalid language-server address'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Only an HTTP loopback language-server origin is allowed');
  }
  url.pathname = '/healthz';
  return url;
}

function positive(value, name, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function createHostLivenessMonitor({
  address,
  onHostGone,
  fetchImpl = globalThis.fetch,
  intervalMs = 5000,
  timeoutMs = 1500,
  failureThreshold = 3,
  graceMs = 15000,
  now = Date.now,
} = {}) {
  const url = healthUrl(address);
  positive(intervalMs, 'probe interval');
  positive(timeoutMs, 'probe timeout');
  positive(graceMs, 'startup grace period', true);
  if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1) throw new TypeError('Invalid failure threshold');
  if (typeof onHostGone !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new TypeError('Lifecycle callbacks must be functions');
  }
  let active = false;
  let stopped = false;
  let notified = false;
  let startedAt = 0;
  let failures = 0;
  let timer = null;
  let controller = null;
  let inFlight = null;

  function clearProbeTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (!active || notified || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      // checkNow handles connection errors and callback failures internally.
      void checkNow();
    }, intervalMs);
    timer.unref?.();
  }

  function checkNow() {
    if (!active || notified) return Promise.resolve({ alive: null, failures, stopped: true });
    if (inFlight) return inFlight;
    clearProbeTimer();
    const probe = new AbortController();
    controller = probe;
    const timeout = setTimeout(() => probe.abort(), timeoutMs);
    // Deferring the body also handles a synchronous throw from fetchImpl
    // without leaving a resolved promise cached as an in-flight probe.
    const task = Promise.resolve().then(async () => {
      try {
        const response = await fetchImpl(url, {
          method: 'GET', redirect: 'manual', cache: 'no-store', signal: probe.signal,
        });
        // Any HTTP response proves that the origin still answers. A 404, 503,
        // auth error, or redirect must not be mistaken for a dead host.
        try {
          const cancellation = response.body?.cancel();
          cancellation?.catch?.(() => {});
        } catch { /* A body cancellation failure does not invalidate a response. */ }
        if (!active) return { alive: null, failures, stopped: true };
        failures = 0;
        return { alive: true, failures };
      } catch {
        if (!active) return { alive: null, failures, stopped: true };
        failures += 1;
        if (failures >= failureThreshold && now() - startedAt >= graceMs) {
          notified = true;
          active = false;
          clearProbeTimer();
          try { Promise.resolve(onHostGone()).catch(() => {}); }
          catch { /* Watchdog callbacks must never create an unhandled error. */ }
        }
        return { alive: false, failures, hostGone: notified };
      } finally {
        clearTimeout(timeout);
        if (controller === probe) controller = null;
        if (inFlight === task) inFlight = null;
        if (active && !notified) schedule();
      }
    });
    inFlight = task;
    return task;
  }

  return {
    // First probe runs after intervalMs. stop() is terminal for this monitor;
    // create a new monitor when attaching to a different host origin.
    start() {
      if (active || stopped || notified) return;
      active = true;
      startedAt = now();
      failures = 0;
      schedule();
    },
    stop() {
      stopped = true;
      active = false;
      clearProbeTimer();
      controller?.abort();
    },
    checkNow,
  };
}

export function createShutdownHandler({
  closeReaders,
  closeServer,
  forceCloseConnections = () => {},
  exit,
  timeoutMs = 3000,
} = {}) {
  positive(timeoutMs, 'shutdown timeout');
  for (const callback of [closeReaders, closeServer, forceCloseConnections, exit]) {
    if (typeof callback !== 'function') throw new TypeError('Shutdown callbacks must be functions');
  }
  let completion = null;
  return function shutdown(reason = 'shutdown') {
    if (completion) return completion;
    let resolveCompletion;
    completion = new Promise(resolve => { resolveCompletion = resolve; });
    let finished = false;
    const finish = forced => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (forced) {
        try { forceCloseConnections(); } catch { /* Still exit if cleanup fails. */ }
      }
      try { exit(0); }
      finally { resolveCompletion({ reason, forced }); }
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    const invoke = callback => {
      try { return Promise.resolve(callback()); }
      catch (error) { return Promise.reject(error); }
    };
    // Start refusing new HTTP work before closing the outgoing state readers.
    // Both operations get the same bounded grace period.
    Promise.allSettled([invoke(closeServer), invoke(closeReaders)]).then(() => finish(false));
    return completion;
  };
}
