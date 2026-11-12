(() => {
  'use strict';
  const messages = {
    'zh-CN': {
      appTitle: '上下文仪表盘', refresh: '刷新数据', readOnly: '只读', language: '界面语言', connecting: '正在连接',
      modelHeading: '当前对话模型', modelLoading: '正在读取', modelWaiting: '等待宿主状态', modelUnknown: '暂未获取',
      noConversation: '未绑定对话', modelSelection: '当前对话设置 · 自动更新', modelRequest: '最近一次请求的模型', modelLog: '最近请求 · 本机日志',
      modelNative: '宿主模型信息', modelPending: '等待宿主提供模型信息', openFromConversation: '请从当前对话打开面板',
      currentContext: '当前上下文', noReference: '基准未设置', waitingData: '等待数据', budgetUsage: '上下文预算占用', referenceUsage: '上下文参考占比',
      manualReference: '手动基准', hostBudget: '宿主预算', logReference: '日志基准', budget: '预算', reference: '基准', used: '已用',
      remainingBudget: '剩余预算', remainingReference: '参考余量', availableBudget: '可用预算', availableShare: '可用比例', referenceUnknown: '基准未知',
      budgetReached: '已达参考值', budgetTight: '预算紧张', budgetWatch: '留意用量', budgetGood: '预算充裕',
      progressLabel: '上下文预算占比', progressUnknown: '参考基准未知，暂无百分比',
      overReference: '已超出参考基准 {tokens} tokens', remainingBudgetTitle: '距宿主压缩预算的参考余量；并非模型总窗口剩余量', remainingReferenceTitle: '按所选计算基准估算的余量（tokens）',
      requestHeading: '最近请求', modelNotRecorded: '模型未记录', input: '未缓存输入', cache: '缓存读取', output: '本次输出', inputTokens: '输入 tokens', cacheShare: '占输入', outputSeparate: '单独列示',
      trendHeading: '近期上下文趋势', inputTrendHeading: '近期输入趋势', trendEmpty: '暂无上下文用量趋势', chartEmpty: '有新的用量记录后显示趋势',
      recentSamples: '最近 {count} 次', awaitingRecords: '等待记录', contextSamples: '宿主上下文采样', requestSamples: '请求的上下文输入',
      trendDescription: '最近 {samples} 次{kind}，从 {start} 到 {end} tokens', awaitingChange: '等待变化', unchanged: '持平', deltaWaiting: '至少两次采样后显示区间变化', deltaTitle: '当前区间变化 {delta} tokens', earlier: '较早', latest: '最近',
      appearance: '外观与阅读', paletteHost: '跟随宿主', paletteMidnight: '午夜蓝', paletteJade: '翡翠', paletteIris: '鸢尾紫', palettePaper: '暖瓷白', paletteGraphite: '石墨',
      paletteChoose: '选择配色', paletteTitle: '{name}配色', fontSize: '字号', fontChoose: '选择字体大小', fontCompact: '紧凑', fontStandard: '标准', fontLarge: '大字',
      referenceSettings: '占比计算基准', autoCustom: '自动 / 自定义', referenceLabel: '参考值（不修改宿主配置）', referenceAuto: '自动读取宿主压缩预算', referenceCustom: '自定义容量',
      referenceCustomLabel: '自定义参考值（tokens）', referencePlaceholder: '输入 token 参考值', apply: '应用',
      capacityHelp: '自动使用宿主压缩预算。手动数值仅改变占比的计算基准，不会改变模型窗口或宿主压缩阈值。',
      capacityInvalid: '请输入 1,024 至 100,000,000 之间的整数。', capacitySession: '浏览器未允许本地保存；当前设置在本次面板打开期间有效。',
      dataHeading: '数据与统计口径', recordTime: '记录时间', logTime: '日志更新', conversation: '当前对话', unbound: '未绑定',
      dataDescription: '宿主预算是当前工作上下文的压缩预算，不等于模型标称总窗口。上下文用量来自宿主估算；日志降级时为最近请求的输入与缓存之和。输出单独列示，不累计各轮请求。',
      readOnlyDescription: '仅读取本机状态与日志，不发送对话消息。状态更新后刷新，并非逐 token 计数。',
      scanWarning: '当前仅展示日志尾部可读取的记录。', bottomCaption: '本机只读 · 对话独立',
      statusNative: '正在读取宿主上下文状态', statusLog: '正在监测本机日志', statusNoConversation: '请在对话中打开面板', statusWaiting: '等待用量记录', statusUnavailable: '本机状态暂不可用', statusInvalid: '对话标识无效', statusInterrupted: '读取暂时中断',
      noteUnknown: '已读取用量；请在下方设置占比计算基准。', noteNative: '按宿主自动压缩预算计算，不代表模型标称窗口；用量为宿主估算。',
      noteManual: '按手动基准计算；该设置不会改变模型窗口或宿主压缩阈值。', noteLog: '最近请求的输入 + 缓存读取；输出单列。', noteOver: '已超过参考基准。', noteNext: '请求写入日志后更新。',
      messageNoConversation: '从当前对话的扩展菜单打开「上下文仪表盘」，以绑定当前对话。', messageWaiting: '等待当前对话的请求完成并写入用量记录。', messageUnavailable: '暂时未能读取本机状态，稍后自动重试。', messageInvalid: '当前对话标识无效，请从会话中重新打开面板。', messageMismatch: '收到的数据与当前对话不一致，已丢弃；稍后自动重试。',
    },
    en: {
      appTitle: 'Context dashboard', refresh: 'Refresh data', readOnly: 'Read only', language: 'Interface language', connecting: 'Connecting',
      modelHeading: 'Conversation model', modelLoading: 'Loading', modelWaiting: 'Waiting for host state', modelUnknown: 'Not available yet',
      noConversation: 'No conversation', modelSelection: 'Conversation setting · updates automatically', modelRequest: 'Model used by the latest request', modelLog: 'Latest request · local log',
      modelNative: 'Model reported by host', modelPending: 'Waiting for model information', openFromConversation: 'Open this panel from a conversation',
      currentContext: 'Current context', noReference: 'No reference', waitingData: 'Waiting', budgetUsage: 'Context budget used', referenceUsage: 'Context usage',
      manualReference: 'Manual reference', hostBudget: 'Host budget', logReference: 'Log reference', budget: 'Budget', reference: 'Reference', used: 'Used',
      remainingBudget: 'Budget left', remainingReference: 'Reference left', availableBudget: 'Available', availableShare: 'Available', referenceUnknown: 'Unknown reference',
      budgetReached: 'Reference reached', budgetTight: 'Budget tight', budgetWatch: 'Watch usage', budgetGood: 'Room available',
      progressLabel: 'Context budget usage', progressUnknown: 'Percentage unavailable: reference is unknown',
      overReference: '{tokens} tokens above the reference', remainingBudgetTitle: 'Estimated room before the host compaction budget; not the model’s full context window', remainingReferenceTitle: 'Estimated room based on the selected reference, in tokens',
      requestHeading: 'Latest request', modelNotRecorded: 'Model not recorded', input: 'Uncached', cache: 'Cache read', output: 'Output', inputTokens: 'Input tokens', cacheShare: 'Input share', outputSeparate: 'Shown separately',
      trendHeading: 'Context trend', inputTrendHeading: 'Input trend', trendEmpty: 'No context usage history yet', chartEmpty: 'The trend appears as usage records arrive',
      recentSamples: 'Last {count}', awaitingRecords: 'Awaiting records', contextSamples: 'host context samples', requestSamples: 'request input samples',
      trendDescription: 'Last {samples} {kind}, from {start} to {end} tokens', awaitingChange: 'Awaiting change', unchanged: 'Unchanged', deltaWaiting: 'At least two samples are needed to show the change', deltaTitle: 'Change over this interval: {delta} tokens', earlier: 'Earlier', latest: 'Latest',
      appearance: 'Appearance', paletteHost: 'Host', paletteMidnight: 'Midnight', paletteJade: 'Jade', paletteIris: 'Iris', palettePaper: 'Paper', paletteGraphite: 'Graphite',
      paletteChoose: 'Choose a color palette', paletteTitle: '{name} palette', fontSize: 'Text size', fontChoose: 'Choose text size', fontCompact: 'Compact', fontStandard: 'Standard', fontLarge: 'Large',
      referenceSettings: 'Usage reference', autoCustom: 'Auto / custom', referenceLabel: 'Display reference (does not change host settings)', referenceAuto: 'Auto: host compaction budget', referenceCustom: 'Custom reference',
      referenceCustomLabel: 'Custom reference, in tokens', referencePlaceholder: 'Reference in tokens', apply: 'Apply',
      capacityHelp: 'Auto uses the host compaction budget. A manual reference only changes the displayed percentage, not the model window or compaction threshold.',
      capacityInvalid: 'Enter an integer from 1,024 to 100,000,000.', capacitySession: 'Local storage is unavailable. This reference is kept for the current panel session only.',
      dataHeading: 'Data & calculation', recordTime: 'Record time', logTime: 'Log updated', conversation: 'Conversation', unbound: 'Not bound',
      dataDescription: 'The host budget is the active context compaction budget, not the model’s full context window. Usage is estimated by the host. The log fallback uses input plus cache reads from the latest request. Output is shown separately; requests are not summed.',
      readOnlyDescription: 'Reads local state and logs only. No chat messages are sent. Refreshes when state changes; this is not a token-by-token counter.',
      scanWarning: 'Only readable records from the end of the log are shown.', bottomCaption: 'Local read only · isolated by conversation',
      statusNative: 'Reading host context', statusLog: 'Monitoring local logs', statusNoConversation: 'Open from a conversation', statusWaiting: 'Awaiting usage', statusUnavailable: 'Local state unavailable', statusInvalid: 'Invalid conversation', statusInterrupted: 'Reading interrupted',
      noteUnknown: 'Usage is available. Set a display reference below to see a percentage.', noteNative: 'Based on the host compaction budget, not the model’s full window. Usage is a host estimate.',
      noteManual: 'Based on your manual reference. This does not change the model window or compaction threshold.', noteLog: 'Latest input + cache reads; output is separate.', noteOver: 'Above the selected reference.', noteNext: 'Updates when the request is written to the log.',
      messageNoConversation: 'Open Context Glance from the conversation’s extensions menu to bind this panel.', messageWaiting: 'Waiting for this conversation to finish a request and record usage.', messageUnavailable: 'Local state could not be read. Retrying shortly.', messageInvalid: 'The conversation ID is invalid. Reopen the panel from a conversation.', messageMismatch: 'Data for another conversation was discarded. Retrying shortly.',
    },
  };
  const attributes = ['title', 'aria-label', 'placeholder'];
  const translate = (language, key, values = {}) => {
    const entry = messages[language]?.[key] ?? messages.en[key] ?? key;
    return entry.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  };
  window.ContextGlanceI18n = Object.freeze({
    languages: Object.freeze(['zh-CN', 'en']),
    messages,
    t: translate,
    apply(language) {
      document.documentElement.lang = language;
      document.documentElement.dataset.language = language;
      document.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = translate(language, element.dataset.i18n);
      });
      for (const attribute of attributes) {
        document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
          element.setAttribute(attribute, translate(language, element.getAttribute(`data-i18n-${attribute}`)));
        });
      }
    },
  });
})();
