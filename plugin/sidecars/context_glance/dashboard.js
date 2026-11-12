(() => {
  'use strict';

  const POLL_MS = 1500;
  const CAPACITY_MINIMUM = 1024;
  const CAPACITY_LIMIT = 100000000;
  const PRESET_CAPACITIES = new Set(['128000', '200000', '256000', '262144', '1000000', '1048576', '2097152']);
  const APPEARANCE_KEY = 'context-glance:appearance:v2';
  const PALETTES = Object.freeze({ host: '跟随宿主', midnight: '午夜蓝', jade: '翡翠', iris: '鸢尾紫', paper: '暖瓷白', graphite: '石墨' });
  const FONT_SIZES = new Set(['compact', 'standard', 'large']);
  const $ = (id) => document.getElementById(id);
  const formatNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const defaultHelp = '自动使用宿主压缩预算。手动数值仅改变占比的计算基准，不会改变模型窗口或宿主压缩阈值。';
  let timer = null;
  let controller = null;
  let generation = 0;
  let stopped = false;
  let activeConversation = '';
  let selectedCapacity = null;

  const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const validCapacity = (value) => Number.isSafeInteger(value) && value >= CAPACITY_MINIMUM && value <= CAPACITY_LIMIT;
  const count = (value) => safeCount(value) === null ? '—' : formatNumber.format(value);
  const currentConversation = () => String(window.sidecar?.conversationId || new URLSearchParams(location.search).get('conversationId') || '').trim();
  const storageKey = (id) => `context-glance:capacity:v1:${id}`;
  let appearance = { palette: 'host', fontSize: 'standard' };

  function readAppearance() {
    try {
      const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY));
      return {
        palette: Object.hasOwn(PALETTES, saved?.palette) ? saved.palette : 'host',
        fontSize: FONT_SIZES.has(saved?.fontSize) ? saved.fontSize : 'standard',
      };
    } catch { return { palette: 'host', fontSize: 'standard' }; }
  }

  function applyAppearance(next, persist = false) {
    appearance = next;
    document.documentElement.dataset.palette = next.palette;
    document.documentElement.dataset.fontSize = next.fontSize;
    $('palette-label').textContent = PALETTES[next.palette];
    document.querySelectorAll('[data-palette]').forEach((button) => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.palette === next.palette));
    });
    document.querySelectorAll('[data-font-size]').forEach((button) => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.fontSize === next.fontSize));
    });
    if (persist) {
      try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); } catch { /* Session-only appearance still works. */ }
    }
  }

  document.querySelectorAll('button[data-palette]').forEach((button) => {
    button.addEventListener('click', () => {
      if (Object.hasOwn(PALETTES, button.dataset.palette)) applyAppearance({ ...appearance, palette: button.dataset.palette }, true);
    });
  });
  document.querySelectorAll('button[data-font-size]').forEach((button) => {
    button.addEventListener('click', () => {
      if (FONT_SIZES.has(button.dataset.fontSize)) applyAppearance({ ...appearance, fontSize: button.dataset.fontSize }, true);
    });
  });
  applyAppearance(readAppearance());

  function readCapacity(id) {
    if (!id) return null;
    try {
      const value = Number(localStorage.getItem(storageKey(id)));
      return validCapacity(value) ? value : null;
    } catch { return null; }
  }

  function writeCapacity(value) {
    selectedCapacity = value;
    if (!activeConversation) return;
    try {
      if (value === null) localStorage.removeItem(storageKey(activeConversation));
      else localStorage.setItem(storageKey(activeConversation), String(value));
    } catch {
      $('capacity-help').textContent = '浏览器未允许本地保存；当前设置在本次面板打开期间有效。';
    }
  }

  function syncCapacityControl() {
    const value = selectedCapacity === null ? 'auto' : String(selectedCapacity);
    $('capacity-select').value = value === 'auto' || PRESET_CAPACITIES.has(value) ? value : 'custom';
    $('custom-capacity-group').hidden = $('capacity-select').value !== 'custom';
    $('custom-capacity').value = selectedCapacity === null ? '' : String(selectedCapacity);
    $('capacity-select').disabled = !activeConversation;
    $('apply-capacity').disabled = !activeConversation;
    $('capacity-help').classList.remove('error');
    $('capacity-help').textContent = defaultHelp;
  }

  function setStatus(label, kind = '') {
    $('status-label').textContent = label;
    $('status-dot').className = `status-dot ${kind}`;
  }

  function setTime(id, raw) {
    const element = $(id);
    const date = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
    const valid = date && Number.isFinite(date.getTime());
    element.textContent = valid ? dateFormat.format(date) : '—';
    if (valid) { element.dateTime = date.toISOString(); element.title = date.toLocaleString(); }
    else { element.removeAttribute('datetime'); element.removeAttribute('title'); }
  }

  function renderTrend(history, native = false) {
    const values = Array.isArray(history) ? history.filter((item) => safeCount(item?.usedTokens) !== null).slice(-40).map((item) => item.usedTokens) : [];
    $('history-count').textContent = values.length ? `最近 ${values.length} 次` : '等待记录';
    $('chart-empty').hidden = values.length > 0;
    $('chart-last').setAttribute('visibility', values.length ? 'visible' : 'hidden');
    $('chart-title').textContent = values.length ? `最近 ${values.length} 次${native ? '宿主上下文采样' : '请求的上下文输入'}，从 ${count(values[0])} 到 ${count(values.at(-1))} tokens` : '暂无上下文用量趋势';
    const delta = values.length > 1 ? values.at(-1) - values[0] : null;
    $('trend-delta').textContent = delta === null ? '等待变化' : delta === 0 ? '持平' : `${delta > 0 ? '+' : '−'}${count(Math.abs(delta))}`;
    $('trend-delta').dataset.direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    $('trend-delta').title = delta === null ? '至少两次采样后显示区间变化' : `当前区间变化 ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${count(Math.abs(delta))} tokens`;
    if (!values.length) { $('chart-line').setAttribute('points', ''); return; }
    const max = Math.max(...values, 1);
    const coordinates = values.map((value, index) => [values.length === 1 ? 316 : 4 + index * 312 / (values.length - 1), 65 - value / max * 56]);
    $('chart-line').setAttribute('points', coordinates.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
    const [x, y] = coordinates.at(-1);
    $('chart-last').setAttribute('cx', String(x));
    $('chart-last').setAttribute('cy', String(y));
  }

  function renderCurrentModel(snapshot) {
    const supplied = snapshot?.currentModel;
    const recorded = snapshot?.metrics?.model;
    const model = supplied && typeof supplied.name === 'string' && supplied.name.trim()
      ? supplied
      : typeof recorded === 'string' && recorded.trim()
        ? { name: recorded, source: 'log' }
        : null;
    const name = model?.name.trim().slice(0, 160);
    const id = typeof model?.id === 'string' ? model.id.trim().slice(0, 160) : '';
    $('current-model-name').textContent = name || (activeConversation ? '暂未获取' : '未绑定对话');
    $('current-model-name').title = name || '';
    const sourceLabels = {
      selection: '当前对话设置 · 自动更新',
      request: '最近一次请求的模型',
      log: '最近请求 · 本机日志',
    };
    $('current-model-status').textContent = model
      ? sourceLabels[model.source] || '宿主模型信息'
      : activeConversation ? '等待宿主提供模型信息' : '请从当前对话打开面板';
    $('current-model-id').textContent = id;
    $('current-model-id').hidden = !id || id === name;
  }

  function render(snapshot) {
    renderCurrentModel(snapshot);
    const metrics = snapshot?.status === 'ok' && snapshot.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics : null;
    const native = snapshot?.source === 'native-context';
    const percent = metrics && typeof metrics.percent === 'number' && Number.isFinite(metrics.percent) && metrics.percent >= 0 ? metrics.percent : null;
    const card = document.querySelector('.usage-card');
    card.classList.toggle('warning', percent !== null && percent >= 75 && percent < 90);
    card.classList.toggle('danger', percent !== null && percent >= 90);
    $('percentage').replaceChildren(document.createTextNode(percent === null ? '--' : percent.toFixed(1)));
    const sign = document.createElement('span');
    sign.className = 'percent-sign'; sign.textContent = '%';
    $('percentage').append(sign);
    const nativeBudget = native && metrics?.capacitySource !== 'manual';
    $('usage-heading').textContent = nativeBudget ? '上下文预算占用' : '上下文参考占比';
    $('trend-heading').textContent = native ? '近期上下文趋势' : '近期输入趋势';
    $('capacity-source').textContent = metrics?.capacitySource === 'manual' ? '手动基准' : metrics?.capacitySource === 'native' ? '宿主预算' : metrics?.capacitySource === 'log' ? '日志基准' : '基准未设置';
    $('limit-label').textContent = nativeBudget ? '预算' : '基准';
    $('remaining-label').textContent = nativeBudget ? '剩余预算' : '参考余量';
    $('available-label').textContent = nativeBudget ? '可用预算' : '可用比例';
    $('progress-fill').style.width = `${percent === null ? 0 : Math.min(percent, 100)}%`;
    if (percent === null) $('progress').removeAttribute('aria-valuenow');
    else $('progress').setAttribute('aria-valuenow', String(Math.min(percent, 100)));
    $('progress').setAttribute('aria-valuetext', percent === null ? '容量未知，暂无百分比' : `${percent.toFixed(1)}%`);
    $('used-count').textContent = count(metrics?.usedTokens);
    $('capacity-count').textContent = count(metrics?.capacityTokens);
    const maximum = safeCount(metrics?.capacityTokens);
    const used = safeCount(metrics?.usedTokens);
    const remaining = maximum !== null && maximum > 0 && used !== null ? Math.max(0, maximum - used) : null;
    $('remaining-count').textContent = count(remaining);
    $('remaining-percent').textContent = remaining === null ? '容量未知' : `${(remaining * 100 / maximum).toFixed(1)}%`;
    $('remaining-count').title = maximum !== null && used !== null && used > maximum ? `已超出参考基准 ${count(used - maximum)} tokens` : nativeBudget ? '距宿主压缩预算的参考余量；并非模型总窗口剩余量' : '按所选计算基准估算的余量（tokens）';
    $('usage-health').textContent = !metrics ? '等待数据' : percent === null ? '基准未知' : percent >= 100 ? '已达参考值' : percent >= 90 ? '预算紧张' : percent >= 75 ? '留意用量' : '预算充裕';
    $('usage-health').dataset.tone = percent === null ? 'neutral' : percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'good';
    $('input-count').textContent = count(metrics?.inputTokens);
    $('cache-count').textContent = count(metrics?.cacheReadTokens);
    $('output-count').textContent = count(metrics?.outputTokens);
    const cachePercent = metrics?.cachePercent;
    $('cache-ratio').textContent = typeof cachePercent === 'number' && Number.isFinite(cachePercent) && cachePercent >= 0 && cachePercent <= 100 ? `${cachePercent.toFixed(0)}%` : '';
    $('step-label').textContent = safeCount(metrics?.stepIndex) === null ? '—' : `#${metrics.stepIndex}`;
    $('model-label').textContent = typeof metrics?.model === 'string' && metrics.model ? metrics.model.slice(0, 120) : native ? '宿主实时状态' : '最近请求';
    $('model-label').title = $('model-label').textContent;
    $('conversation-label').textContent = activeConversation ? `${activeConversation.slice(0, 8)}…` : '未绑定';
    $('conversation-label').title = activeConversation;
    setTime('updated-at', snapshot?.updatedAt);
    setTime('log-updated-at', snapshot?.logModifiedAt);
    renderTrend(metrics ? snapshot.history : [], native);
    $('scan-warning').hidden = !snapshot?.scanTruncated;

    const status = snapshot?.status;
    if (status === 'ok') {
      setStatus(native ? '正在读取宿主上下文状态' : '正在监测本机日志', 'ready');
      $('usage-note').textContent = percent === null
        ? '已读取用量；请在下方设置占比计算基准。'
        : nativeBudget
          ? '按宿主自动压缩预算计算，不代表模型标称窗口；用量为宿主估算。'
          : metrics?.capacitySource === 'manual'
            ? '按手动基准计算；该设置不会改变模型窗口或宿主压缩阈值。'
            : `最近请求的输入 + 缓存读取；输出单列。${percent > 100 ? '已超过参考基准。' : '请求写入日志后更新。'}`;
    } else {
      const labels = { 'no-conversation': '请在对话中打开面板', waiting: '等待用量记录', unavailable: '本机状态暂不可用', 'invalid-conversation': '对话标识无效' };
      setStatus(labels[status] || '读取暂时中断', status === 'unavailable' || status === 'invalid-conversation' ? 'warning' : '');
      $('usage-note').textContent = typeof snapshot?.message === 'string' ? snapshot.message.slice(0, 300) : '等待当前对话的请求完成并写入日志。';
    }
  }

  function clearPending() {
    clearTimeout(timer); timer = null;
    controller?.abort(); controller = null;
    generation += 1;
  }

  function switchConversation(id) {
    activeConversation = id;
    selectedCapacity = readCapacity(id);
    syncCapacityControl();
    render({ status: id ? 'waiting' : 'no-conversation', message: id ? '正在读取此对话的本机用量记录。' : '从当前对话的扩展菜单打开「上下文仪表盘」，以绑定当前对话。' });
  }

  async function poll() {
    if (stopped || document.hidden) return;
    const conversationId = currentConversation();
    if (conversationId !== activeConversation) switchConversation(conversationId);
    if (!conversationId) {
      render({ status: 'no-conversation', message: '从当前对话的扩展菜单打开「上下文仪表盘」，以绑定当前对话。' });
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    const ticket = ++generation;
    const requestController = new AbortController();
    controller = requestController;
    $('refresh').disabled = true;
    const timeout = setTimeout(() => requestController.abort(), 8000);
    try {
      const params = new URLSearchParams({ conversationId });
      if (validCapacity(selectedCapacity)) params.set('capacity', String(selectedCapacity));
      const fetcher = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : window.fetch.bind(window);
      const response = await fetcher(`/api/snapshot?${params}`, { method: 'GET', signal: requestController.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      if (ticket !== generation || currentConversation() !== conversationId || stopped || document.hidden) return;
      if (snapshot.conversationId !== conversationId) throw new Error('conversation-mismatch');
      render(snapshot);
    } catch (error) {
      if (ticket !== generation || currentConversation() !== conversationId || stopped || document.hidden) return;
      render({ status: 'unavailable', message: error?.message === 'conversation-mismatch' ? '收到的数据与当前对话不一致，已丢弃；稍后自动重试。' : '暂时未能读取本机状态，稍后自动重试。' });
    } finally {
      clearTimeout(timeout);
      if (ticket === generation) {
        controller = null;
        $('refresh').disabled = false;
        if (!stopped && !document.hidden) timer = setTimeout(poll, POLL_MS);
      }
    }
  }

  function refresh() {
    clearPending();
    $('refresh').disabled = false;
    if (!stopped && !document.hidden) poll();
  }

  $('capacity-select').addEventListener('change', () => {
    const value = $('capacity-select').value;
    $('custom-capacity-group').hidden = value !== 'custom';
    $('capacity-help').classList.remove('error');
    $('capacity-help').textContent = defaultHelp;
    if (value === 'custom') { $('custom-capacity').focus(); return; }
    writeCapacity(value === 'auto' ? null : Number(value));
    refresh();
  });

  function applyCustomCapacity() {
    const raw = $('custom-capacity').value.trim();
    const capacity = Number(raw);
    if (!/^\d+$/.test(raw) || !validCapacity(capacity)) {
      $('capacity-help').textContent = '请输入 1,024 至 100,000,000 之间的整数。';
      $('capacity-help').classList.add('error');
      $('custom-capacity').focus();
      return;
    }
    $('capacity-help').classList.remove('error');
    $('capacity-help').textContent = defaultHelp;
    writeCapacity(capacity);
    refresh();
  }

  $('apply-capacity').addEventListener('click', applyCustomCapacity);
  $('custom-capacity').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyCustomCapacity(); } });
  $('refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPending(); else refresh(); });
  window.addEventListener('pagehide', () => { stopped = true; clearPending(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { stopped = false; refresh(); } });
  window.addEventListener('popstate', refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY || event.key === null) applyAppearance(readAppearance());
    if (activeConversation && event.key === storageKey(activeConversation)) { selectedCapacity = readCapacity(activeConversation); syncCapacityControl(); refresh(); }
  });
  switchConversation(currentConversation());
  poll();
})();
