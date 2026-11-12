(() => {
  'use strict';

  const POLL_MS = 1500;
  const CAPACITY_MINIMUM = 1024;
  const CAPACITY_LIMIT = 100000000;
  const PRESET_CAPACITIES = new Set(['128000', '200000', '256000', '262144', '1000000', '1048576', '2097152']);
  const APPEARANCE_KEY = 'context-glance:appearance:v2';
  const LANGUAGE_KEY = 'context-glance:language:v1';
  const I18N = window.ContextGlanceI18n;
  const PALETTES = Object.freeze({ host: 'paletteHost', midnight: 'paletteMidnight', jade: 'paletteJade', iris: 'paletteIris', paper: 'palettePaper', graphite: 'paletteGraphite' });
  const FONT_SIZES = new Set(['compact', 'standard', 'large']);
  const $ = (id) => document.getElementById(id);
  let language = readLanguage();
  let formatNumber;
  let dateFormat;
  const t = (key, values) => I18N.t(language, key, values);
  let timer = null;
  let controller = null;
  let generation = 0;
  let stopped = false;
  let activeConversation = '';
  let selectedCapacity = null;
  let lastSnapshot = null;
  let helpState = 'capacityHelp';

  const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const validCapacity = (value) => Number.isSafeInteger(value) && value >= CAPACITY_MINIMUM && value <= CAPACITY_LIMIT;
  const count = (value) => safeCount(value) === null ? '—' : formatNumber.format(value);
  const currentConversation = () => String(window.sidecar?.conversationId || new URLSearchParams(location.search).get('conversationId') || '').trim();
  const storageKey = (id) => `context-glance:capacity:v1:${id}`;
  let appearance = { palette: 'host', fontSize: 'standard' };

  function readLanguage() {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (I18N.languages.includes(saved)) return saved;
    } catch { /* Browser locale still works without local storage. */ }
    return /^zh(?:-|$)/i.test(navigator.language || '') ? 'zh-CN' : 'en';
  }

  function showCapacityHelp(key = helpState) {
    helpState = key;
    $('capacity-help').textContent = t(key);
    $('capacity-help').classList.toggle('error', key === 'capacityInvalid');
  }

  function applyLanguage(next, persist = false) {
    language = I18N.languages.includes(next) ? next : 'en';
    formatNumber = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
    dateFormat = new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    I18N.apply(language);
    $('language-select').value = language;
    $('palette-label').textContent = t(PALETTES[appearance.palette]);
    document.querySelectorAll('button[data-palette]').forEach(button => {
      button.title = t('paletteTitle', { name: t(PALETTES[button.dataset.palette]) });
    });
    showCapacityHelp();
    if (lastSnapshot) render(lastSnapshot);
    if (persist) {
      try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Session choice remains usable. */ }
    }
  }

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
    $('palette-label').textContent = t(PALETTES[next.palette]);
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
      showCapacityHelp('capacitySession');
    }
  }

  function syncCapacityControl() {
    const value = selectedCapacity === null ? 'auto' : String(selectedCapacity);
    $('capacity-select').value = value === 'auto' || PRESET_CAPACITIES.has(value) ? value : 'custom';
    $('custom-capacity-group').hidden = $('capacity-select').value !== 'custom';
    $('custom-capacity').value = selectedCapacity === null ? '' : String(selectedCapacity);
    $('capacity-select').disabled = !activeConversation;
    $('apply-capacity').disabled = !activeConversation;
    showCapacityHelp('capacityHelp');
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
    if (valid) { element.dateTime = date.toISOString(); element.title = date.toLocaleString(language, { hour12: false }); }
    else { element.removeAttribute('datetime'); element.removeAttribute('title'); }
  }

  function renderTrend(history, native = false) {
    const values = Array.isArray(history) ? history.filter((item) => safeCount(item?.usedTokens) !== null).slice(-40).map((item) => item.usedTokens) : [];
    $('history-count').textContent = values.length ? t('recentSamples', { count: count(values.length) }) : t('awaitingRecords');
    $('chart-empty').hidden = values.length > 0;
    $('chart-last').setAttribute('visibility', values.length ? 'visible' : 'hidden');
    $('chart-title').textContent = values.length ? t('trendDescription', { samples: count(values.length), kind: t(native ? 'contextSamples' : 'requestSamples'), start: count(values[0]), end: count(values.at(-1)) }) : t('trendEmpty');
    const delta = values.length > 1 ? values.at(-1) - values[0] : null;
    $('trend-delta').textContent = delta === null ? t('awaitingChange') : delta === 0 ? t('unchanged') : `${delta > 0 ? '+' : '−'}${count(Math.abs(delta))}`;
    $('trend-delta').dataset.direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    $('trend-delta').title = delta === null ? t('deltaWaiting') : t('deltaTitle', { delta: `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${count(Math.abs(delta))}` });
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
    $('current-model-name').textContent = name || t(activeConversation ? 'modelUnknown' : 'noConversation');
    $('current-model-name').title = name || '';
    const sourceLabels = {
      selection: 'modelSelection',
      request: 'modelRequest',
      log: 'modelLog',
    };
    $('current-model-status').textContent = model
      ? t(sourceLabels[model.source] || 'modelNative')
      : t(activeConversation ? 'modelPending' : 'openFromConversation');
    $('current-model-id').textContent = id;
    $('current-model-id').hidden = !id || id === name;
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
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
    $('usage-heading').textContent = t(nativeBudget ? 'budgetUsage' : 'referenceUsage');
    $('trend-heading').textContent = t(native ? 'trendHeading' : 'inputTrendHeading');
    $('capacity-source').textContent = t(metrics?.capacitySource === 'manual' ? 'manualReference' : metrics?.capacitySource === 'native' ? 'hostBudget' : metrics?.capacitySource === 'log' ? 'logReference' : 'noReference');
    $('limit-label').textContent = t(nativeBudget ? 'budget' : 'reference');
    $('remaining-label').textContent = t(nativeBudget ? 'remainingBudget' : 'remainingReference');
    $('available-label').textContent = t(nativeBudget ? 'availableBudget' : 'availableShare');
    $('progress-fill').style.width = `${percent === null ? 0 : Math.min(percent, 100)}%`;
    if (percent === null) $('progress').removeAttribute('aria-valuenow');
    else $('progress').setAttribute('aria-valuenow', String(Math.min(percent, 100)));
    $('progress').setAttribute('aria-valuetext', percent === null ? t('progressUnknown') : `${percent.toFixed(1)}%`);
    $('used-count').textContent = count(metrics?.usedTokens);
    $('capacity-count').textContent = count(metrics?.capacityTokens);
    const maximum = safeCount(metrics?.capacityTokens);
    const used = safeCount(metrics?.usedTokens);
    const remaining = maximum !== null && maximum > 0 && used !== null ? Math.max(0, maximum - used) : null;
    $('remaining-count').textContent = count(remaining);
    $('remaining-percent').textContent = remaining === null ? t('referenceUnknown') : `${(remaining * 100 / maximum).toFixed(1)}%`;
    $('remaining-count').title = maximum !== null && used !== null && used > maximum ? t('overReference', { tokens: count(used - maximum) }) : t(nativeBudget ? 'remainingBudgetTitle' : 'remainingReferenceTitle');
    $('usage-health').textContent = t(!metrics ? 'waitingData' : percent === null ? 'referenceUnknown' : percent >= 100 ? 'budgetReached' : percent >= 90 ? 'budgetTight' : percent >= 75 ? 'budgetWatch' : 'budgetGood');
    $('usage-health').dataset.tone = percent === null ? 'neutral' : percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'good';
    $('input-count').textContent = count(metrics?.inputTokens);
    $('cache-count').textContent = count(metrics?.cacheReadTokens);
    $('output-count').textContent = count(metrics?.outputTokens);
    const cachePercent = metrics?.cachePercent;
    $('cache-ratio').textContent = typeof cachePercent === 'number' && Number.isFinite(cachePercent) && cachePercent >= 0 && cachePercent <= 100 ? `${cachePercent.toFixed(0)}%` : '';
    $('step-label').textContent = safeCount(metrics?.stepIndex) === null ? '—' : `#${metrics.stepIndex}`;
    $('model-label').textContent = typeof metrics?.model === 'string' && metrics.model ? metrics.model.slice(0, 120) : t(native ? 'modelNative' : 'requestHeading');
    $('model-label').title = $('model-label').textContent;
    $('conversation-label').textContent = activeConversation ? `${activeConversation.slice(0, 8)}…` : t('unbound');
    $('conversation-label').title = activeConversation;
    setTime('updated-at', snapshot?.updatedAt);
    setTime('log-updated-at', snapshot?.logModifiedAt);
    renderTrend(metrics ? snapshot.history : [], native);
    $('scan-warning').hidden = !snapshot?.scanTruncated;

    const status = snapshot?.status;
    if (status === 'ok') {
      setStatus(t(native ? 'statusNative' : 'statusLog'), 'ready');
      $('usage-note').textContent = percent === null
        ? t('noteUnknown')
        : nativeBudget
          ? t('noteNative')
          : metrics?.capacitySource === 'manual'
            ? t('noteManual')
            : `${t('noteLog')} ${t(percent > 100 ? 'noteOver' : 'noteNext')}`;
    } else {
      const labels = { 'no-conversation': 'statusNoConversation', waiting: 'statusWaiting', unavailable: 'statusUnavailable', 'invalid-conversation': 'statusInvalid' };
      const notes = { 'no-conversation': 'messageNoConversation', waiting: 'messageWaiting', unavailable: 'messageUnavailable', 'invalid-conversation': 'messageInvalid' };
      setStatus(t(labels[status] || 'statusInterrupted'), status === 'unavailable' || status === 'invalid-conversation' ? 'warning' : '');
      $('usage-note').textContent = t(snapshot?.reason === 'conversation-mismatch' ? 'messageMismatch' : notes[status] || 'messageWaiting');
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
    render({ status: id ? 'waiting' : 'no-conversation' });
  }

  async function poll() {
    if (stopped || document.hidden) return;
    const conversationId = currentConversation();
    if (conversationId !== activeConversation) switchConversation(conversationId);
    if (!conversationId) {
      render({ status: 'no-conversation' });
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
      render({ status: 'unavailable', reason: error?.message === 'conversation-mismatch' ? 'conversation-mismatch' : undefined });
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
    showCapacityHelp('capacityHelp');
    if (value === 'custom') { $('custom-capacity').focus(); return; }
    writeCapacity(value === 'auto' ? null : Number(value));
    refresh();
  });

  function applyCustomCapacity() {
    const raw = $('custom-capacity').value.trim();
    const capacity = Number(raw);
    if (!/^\d+$/.test(raw) || !validCapacity(capacity)) {
      showCapacityHelp('capacityInvalid');
      $('custom-capacity').focus();
      return;
    }
    showCapacityHelp('capacityHelp');
    writeCapacity(capacity);
    refresh();
  }

  $('apply-capacity').addEventListener('click', applyCustomCapacity);
  $('custom-capacity').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyCustomCapacity(); } });
  $('refresh').addEventListener('click', refresh);
  $('language-select').addEventListener('change', () => applyLanguage($('language-select').value, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPending(); else refresh(); });
  window.addEventListener('pagehide', () => { stopped = true; clearPending(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { stopped = false; refresh(); } });
  window.addEventListener('popstate', refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === LANGUAGE_KEY || event.key === null) applyLanguage(readLanguage());
    if (event.key === APPEARANCE_KEY || event.key === null) applyAppearance(readAppearance());
    if (activeConversation && event.key === storageKey(activeConversation)) { selectedCapacity = readCapacity(activeConversation); syncCapacityControl(); refresh(); }
  });
  applyLanguage(language);
  switchConversation(currentConversation());
  poll();
})();
