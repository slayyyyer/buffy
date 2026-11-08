/* global window, document, performance, requestAnimationFrame, BuffyHobbies, BuffyCharacters, Image */
(function buffyOverlay() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const app = $('app');
  const hit = $('hit');
  const pill = $('pill');
  const pillName = $('pill-name');
  const pillState = $('pill-state');
  const pillProject = $('pill-project');
  const pillPending = $('pill-pending');
  const bubble = $('bubble');
  const bubbleSource = $('bubble-source');
  const bubbleText = $('bubble-text');
  const toolbar = $('toolbar');
  const toolbarPending = $('toolbar-pending');
  const composeEl = $('composer');
  const draftEl = $('draft');
  const composerNote = $('composer-note');
  const copyDraft = $('copy-draft');
  const handoffButton = $('handoff');
  const cardsEl = $('cards');
  const cardsTabs = $('cards-tabs');
  const cardsBody = $('cards-body');
  const compactBadge = $('compact-badge');
  const compactCount = $('compact-count');
  const toastEl = $('toast');
  const PILL_GAP = 8;

  const STATE_LABELS = {
    idle: 'Idle',
    thinking: 'Thinking',
    working: 'Working',
    'needs-you': 'Needs you',
    error: 'Error',
    done: 'Finished',
    offline: 'Offline',
    sleepy: 'Resting',
    pet: 'Happy',
    wave: 'Hi',
  };
  const CATEGORY_LABELS = {
    thinking: 'thinking',
    reading: 'reading',
    searching: 'searching',
    editing: 'editing',
    running: 'running',
    delegating: 'delegating',
    compacting: 'compacting',
    planning: 'planning',
    tool: 'tool',
    waiting: 'waiting',
    permission: 'permission',
    question: 'question',
    completion: '',
    interrupted: 'interrupted',
    'session-end': 'session ended',
    'idle-reminder': 'waiting for you',
    error: 'error',
    'editing-inferred': 'changes',
    'settled-inferred': 'settled',
  };

  const state = {
    snapshot: null,
    prefs: null,
    catalog: null,
    offline: false,
    mode: 'full',
    scale: 1,
    visible: document.visibilityState !== 'hidden',
    cursor: null,
    hovered: false,
    composerOpen: false,
    cardsOpen: false,
    tab: 'live',
    greetingAt: 0,
    petAt: 0,
    celebrateAt: 0,
    lastCelebrationAt: 0,
    bubbleUntil: 0,
    lastSeq: null,
    lastReactionAt: 0,
    lastMessage: '',
    draftRevision: 0,
    handoffInFlight: false,
    dictationAvailable: false,
    dictationReason: '',
    customImage: null,
    customKey: '',
    lastIgnore: null,
    frameId: null,
    lastPillAt: 0,
    lastGestureAt: 0,
    toastTimer: null,
    pointer: null,
    trail: [],
    pillTop: null,
    pillDirty: false,
    pillBlocked: false,
    audio: null,
  };

  const personality = () => state.prefs?.personality || {};
  const scheduler = BuffyHobbies.createHobbyScheduler({
    now: performance.now(),
    idleHobbies: true,
    sleepAfterMs: 120000,
  });

  function characterId() {
    return state.prefs?.companion?.characterId || state.catalog?.characters?.[0]?.id || 'buffy';
  }

  function characterPrefs() {
    const id = characterId();
    return (
      state.prefs?.characters?.[id] || {
        look: { outfit: 'dress', bow: 'pink', hat: 'none', glasses: 'none', wand: 'none', theme: 'plum' },
        clothing: { outfit: true, bow: true, hat: true, glasses: true, wand: true },
      }
    );
  }

  function look() {
    return characterPrefs().look || {};
  }

  function clothing() {
    return characterPrefs().clothing || {};
  }

  function companionName() {
    return state.prefs?.companion?.name || state.snapshot?.pet?.name || 'Buffy';
  }

  function baseState() {
    if (state.offline) return 'offline';
    return state.snapshot?.current?.state || 'idle';
  }

  function pendingCount() {
    return Number(state.snapshot?.pendingRequests || 0);
  }

  function currentCategory() {
    return state.snapshot?.current?.category || 'thinking';
  }

  function currentObserved() {
    return state.snapshot?.current?.observed || 'explicit';
  }

  function isSleepy(now) {
    return baseState() === 'idle' && personality().sleepy !== false && scheduler.isAsleep(now);
  }

  function localState(now) {
    if (state.offline) return 'offline';
    const base = baseState();
    if (base !== 'idle') return base;
    if (now - state.petAt < 1700) return 'pet';
    if (now - state.greetingAt < 1600 && personality().returnGreetings !== false) return 'wave';
    if (isSleepy(now) && !state.hovered) return 'sleepy';
    return 'idle';
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutHit();
    schedulePillLayout();
  }

  function layoutHit() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (state.mode === 'compact') {
      hit.style.left = `${Math.round(width * 0.1)}px`;
      hit.style.top = `${Math.round(height * 0.14)}px`;
      hit.style.width = `${Math.round(width * 0.8)}px`;
      hit.style.height = `${Math.round(height * 0.62)}px`;
    } else {
      hit.style.left = `${Math.round(width * 0.15)}px`;
      hit.style.top = `${Math.round(height * 0.16)}px`;
      hit.style.width = `${Math.round(width * 0.7)}px`;
      hit.style.height = `${Math.round(height * 0.6)}px`;
    }
  }

  function schedulePillLayout() {
    state.pillDirty = true;
    state.pillBlocked = false;
  }

  function measureHeadTop() {
    try {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let y = 0; y < height; y += 1) {
        const row = y * width * 4;
        for (let x = 0; x < width; x += 1) {
          if (data[row + x * 4 + 3] > 12) return y / dpr;
        }
      }
      return null;
    } catch {
      state.pillBlocked = true;
      return null;
    }
  }

  function updatePillTop(local) {
    if (state.mode === 'compact') {
      state.pillDirty = false;
      if (state.pillTop !== null) {
        state.pillTop = null;
        pill.style.removeProperty('top');
        bubble.style.removeProperty('bottom');
        bubble.style.removeProperty('top');
      }
      return;
    }
    if (!state.pillDirty || state.pillBlocked || local !== 'idle') return;
    const headTop = measureHeadTop();
    if (headTop === null) return;
    state.pillDirty = false;
    const top = Math.max(8, Math.round(headTop - pill.offsetHeight - PILL_GAP));
    state.pillTop = top;
    pill.style.top = `${top}px`;
    // Hang the speech bubble just above the pill so it grows upward into the
    // empty header instead of covering her head.
    bubble.style.top = 'auto';
    bubble.style.bottom = `${Math.max(0, Math.round(window.innerHeight - top + PILL_GAP))}px`;
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] ?? String(category || '').replace(/-/g, ' ');
  }

  function ageLabel(at) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(at || Date.now())) / 1000));
    if (seconds < 10) return 'now';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function showToast(text) {
    if (!text) return;
    toastEl.textContent = String(text).slice(0, 220);
    toastEl.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 4200);
  }

  function showBubble(text, source, observed, sticky = false, durationMs = 6500) {
    if (!text) {
      hideBubble();
      return;
    }
    bubbleText.textContent = text;
    bubbleSource.textContent = String(source || '').slice(0, 22);
    bubbleSource.dataset.observed = observed || 'explicit';
    bubbleSource.title = observed === 'inferred' ? 'Inferred from file activity, not an explicit agent event' : '';
    bubble.classList.remove('hidden');
    state.bubbleUntil = sticky ? Infinity : performance.now() + durationMs;
  }

  function hideBubble() {
    bubble.classList.add('hidden');
    state.bubbleUntil = 0;
  }

  function updateBadges() {
    const count = pendingCount();
    const text = String(count);
    pillPending.textContent = text;
    toolbarPending.textContent = text;
    compactCount.textContent = text;
    pillPending.hidden = count === 0;
    toolbarPending.hidden = count === 0;
    compactBadge.hidden = count === 0;
    pillPending.setAttribute(
      'aria-label',
      count ? `${count} pending request${count === 1 ? '' : 's'}` : 'No pending requests',
    );
  }

  // A short two-note chime for alert sounds. Volume comes from preferences,
  // and the system beep style stays untouched in the main process.
  function playChime(volume = 60) {
    const level = Math.min(1, Math.max(0, Number(volume) / 100));
    if (!level) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!state.audio) state.audio = new Ctx();
      const ctx = state.audio;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.02;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14 * level, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.44);
      for (const [frequency, delay] of [
        [880, 0],
        [1318.5, 0.11],
      ]) {
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start + delay);
        oscillator.connect(gain);
        oscillator.start(start + delay);
        oscillator.stop(start + delay + 0.4);
      }
    } catch {
      /* sound is optional */
    }
  }

  function updatePill(now = performance.now()) {
    const local = localState(now);
    const base = baseState();
    app.dataset.state = local === 'sleepy' ? 'idle' : local;
    pillName.textContent = companionName();
    const stateLabel = STATE_LABELS[local] || STATE_LABELS[base] || 'Idle';
    const detail = categoryLabel(currentCategory());
    pillState.textContent =
      local === 'sleepy'
        ? 'Resting'
        : base === 'needs-you'
          ? `Needs you${detail ? ` · ${detail}` : ''}`
          : base === 'idle'
            ? stateLabel
            : `${stateLabel}${detail ? ` · ${detail}` : ''}`;
    const project =
      state.snapshot?.watch?.directory && state.snapshot.watch.enabled !== false
        ? String(state.snapshot.watch.directory).split(/[\\/]/).filter(Boolean).pop()
        : '';
    pillProject.textContent = project || '';
    pillProject.hidden =
      !project || state.mode === 'compact' || project.toLowerCase() === companionName().toLowerCase();
    // Compact mode has no room for a second line, so the message replaces the
    // state label inside the pill. The dot still carries the state colour.
    const compactMessage = state.snapshot?.current?.message;
    if (state.mode === 'compact' && compactMessage) pillState.textContent = compactMessage;
    pill.title = `${companionName()} — ${pillState.textContent}${project ? ` in ${project}` : ''}`;
    updateBadges();
    if (state.snapshot?.reaction?.kind === 'pet' && state.snapshot.reaction.at !== state.lastReactionAt) {
      state.lastReactionAt = state.snapshot.reaction.at;
      state.petAt = now;
      scheduler.activity(now);
      showBubble('That tickles!', 'you', 'explicit', false, 1900);
    }
    const celebration = state.snapshot?.celebration;
    if (celebration && celebration.at !== state.lastCelebrationAt) {
      state.lastCelebrationAt = celebration.at;
      state.celebrateAt = now;
      scheduler.activity(now);
      showBubble(celebration.message || 'All green!', 'buffy', 'explicit', false, 3000);
    }
  }

  function responseSummary(session) {
    if (session.pendingRequests) {
      return `${session.pendingRequests} waiting`;
    }
    return `${STATE_LABELS[session.state] || session.state}${session.category ? ` · ${categoryLabel(session.category)}` : ''}`;
  }

  function makeButton(label, action, data = {}, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    if (danger) button.className = 'danger';
    for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
    return button;
  }

  function requestCard(request) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.tone = 'request';
    card.dataset.state = 'needs-you';

    const top = document.createElement('div');
    top.className = 'card-top';
    const dot = document.createElement('span');
    dot.className = 'card-dot';
    dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.className = 'card-title';
    title.textContent = request.kind === 'permission' ? 'Permission needed' : 'Question waiting';
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = `${request.source || 'claude'} · ${ageLabel(request.createdAt)}`;
    top.append(dot, title, meta);

    const message = document.createElement('p');
    message.className = 'card-message';
    message.textContent = request.label || 'Claude is waiting for you.';

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (request.cwd) {
      actions.append(makeButton('Show project', 'focus-session', { session: request.sessionId, cwd: request.cwd }));
    }
    actions.append(makeButton('Open Claude', 'open-claude'), makeButton('Dismiss', 'dismiss', { session: request.sessionId }, true));
    card.append(top, message, actions);
    return card;
  }

  function sessionCard(session) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.state = session.state;
    const top = document.createElement('div');
    top.className = 'card-top';
    const dot = document.createElement('span');
    dot.className = 'card-dot';
    dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.className = 'card-title';
    title.textContent = `${session.source || 'agent'}${session.id && session.id !== session.source ? ` · ${String(session.id).replace(/^[^:]+:/, '').slice(0, 10)}` : ''}`;
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = `${responseSummary(session)} · ${ageLabel(session.updatedAt)}`;
    top.append(dot, title, meta);

    const message = document.createElement('p');
    message.className = 'card-message';
    message.textContent = session.message || 'No detail from the agent.';
    if (session.observed === 'inferred') {
      const note = document.createElement('span');
      note.className = 'card-meta';
      note.textContent = ' inferred from repository activity';
      message.append(note);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (session.cwd) {
      actions.append(makeButton('Show project', 'focus-session', { session: session.id, cwd: session.cwd }));
    }
    actions.append(makeButton('Dismiss', 'dismiss', { session: session.id }, true));
    card.append(top, message, actions);
    return card;
  }

  function recentCard(completion) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.state = 'done';
    const top = document.createElement('div');
    top.className = 'card-top';
    const dot = document.createElement('span');
    dot.className = 'card-dot';
    dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.className = 'card-title';
    title.textContent = completion.observed === 'inferred' ? 'Activity settled' : 'Turn finished';
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = `${completion.source || 'agent'} · ${ageLabel(completion.at)}`;
    top.append(dot, title, meta);
    const message = document.createElement('p');
    message.className = 'card-message';
    message.textContent = completion.message || (completion.observed === 'inferred' ? 'Repository changes settled; no test result was observed.' : 'The agent finished responding.');
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(makeButton('Open Claude', 'open-claude'));
    card.append(top, message, actions);
    return card;
  }

  function renderCards() {
    if (!state.cardsOpen) return;
    cardsTabs.querySelectorAll('[data-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
    });
    const body = document.createDocumentFragment();
    if (state.tab === 'live') {
      const requests = state.snapshot?.pendingRequestsList || [];
      if (requests.length) {
        const notice = document.createElement('p');
        notice.className = 'notice';
        notice.textContent = 'Show project opens the folder that session reported. Opening Claude starts a new composer; neither resolves the request.';
        body.append(notice);
      }
      requests.forEach((request) => body.append(requestCard(request)));
      const sessions = (state.snapshot?.sessions || []).filter(
        (session) => !requests.some((request) => request.sessionId === session.id),
      );
      sessions.forEach((session) => body.append(sessionCard(session)));
      if (!requests.length && !sessions.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = state.offline
          ? 'The local daemon is offline. Buffy reconnects automatically when it returns.'
          : 'No agent activity right now. Start Claude Code or a Freebuff session and Buffy will follow along.';
        body.append(empty);
      }
    } else {
      const recent = state.snapshot?.recentCompletions || [];
      recent.forEach((completion) => body.append(recentCard(completion)));
      if (!recent.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Recent completions appear here for about five minutes.';
        body.append(empty);
      }
    }
    cardsBody.replaceChildren(body);
    const snoozedUntil = state.prefs?.alerts?.snoozeUntil;
    const active = snoozedUntil && Date.parse(snoozedUntil) > Date.now();
    document.querySelectorAll('[data-snooze]').forEach((button) => {
      button.setAttribute('aria-pressed', String(active ? button.dataset.snooze !== '0' : button.dataset.snooze === '0'));
    });
  }

  function applyMode(payload) {
    if (!payload) return;
    const mode = payload.mode || 'full';
    state.mode = mode;
    state.scale = payload.scale || 1;
    app.dataset.mode = mode;
    layoutHit();
    schedulePillLayout();
    const dictation = payload.dictation;
    if (dictation) {
      state.dictationAvailable = dictation.available === true;
      state.dictationReason = dictation.reason || '';
      const button = toolbar.querySelector('[data-action="dictate"]');
      if (button) {
        button.hidden = !state.dictationAvailable;
        button.title = state.dictationAvailable ? 'Dictation' : state.dictationReason;
      }
    }
    if (mode === 'compact') {
      state.composerOpen = false;
      state.cardsOpen = false;
      composeEl.classList.add('hidden');
      cardsEl.classList.add('hidden');
      scheduler.activity(performance.now());
    }
    const compactButton = toolbar.querySelector('[data-action="compact"]');
    if (compactButton) {
      compactButton.setAttribute('aria-label', mode === 'compact' ? 'Expand Buffy' : 'Switch to compact mode');
      compactButton.title = mode === 'compact' ? 'Expand' : 'Compact mode';
    }
    updatePill();
  }

  async function requestMode(mode) {
    try {
      const result = await window.buffy.requestMode(mode);
      applyMode(result);
      return result;
    } catch {
      return null;
    }
  }

  async function openComposer() {
    if (state.mode === 'compact') await requestMode('full');
    closeCards({ restoreFocus: false, skipMode: true });
    state.composerOpen = true;
    composeEl.classList.remove('hidden');
    setIgnoreMouse(false);
    await requestMode('compose');
    composeEl.classList.remove('hidden');
    const draft = await window.buffy.getComposer().catch(() => null);
    if (draft) {
      state.draftRevision = draft.revision || 0;
      if (draft.text && draft.text !== draftEl.value) draftEl.value = draft.text;
    }
    draftEl.focus();
    draftEl.setSelectionRange(draftEl.value.length, draftEl.value.length);
    scheduler.activity(performance.now());
  }

  async function closeComposer({ restoreFocus = true } = {}) {
    if (!state.composerOpen) return;
    state.composerOpen = false;
    composeEl.classList.add('hidden');
    composeDraftToMain();
    try {
      await window.buffy.closeComposer({ restoreFocus });
    } catch {
      /* the window can still be restored below */
    }
    if (!state.cardsOpen) await requestMode('full');
    scheduler.activity(performance.now());
  }

  async function openCards() {
    if (state.mode === 'compact') await requestMode('full');
    await closeComposer({ restoreFocus: false });
    state.cardsOpen = true;
    cardsEl.classList.remove('hidden');
    setIgnoreMouse(false);
    await requestMode('cards');
    cardsEl.classList.remove('hidden');
    renderCards();
    scheduler.activity(performance.now());
  }

  async function closeCards({ restoreFocus = true, skipMode = false } = {}) {
    if (!state.cardsOpen) return;
    state.cardsOpen = false;
    cardsEl.classList.add('hidden');
    if (!skipMode) {
      try {
        await window.buffy.closeComposer({ restoreFocus });
      } catch {
        /* ignore */
      }
      if (!state.composerOpen) await requestMode('full');
    }
    scheduler.activity(performance.now());
  }

  function composerNoteText(text, tone = '') {
    composerNote.textContent = text || '';
    composerNote.dataset.tone = tone;
  }

  function composeDraftToMain() {
    const text = draftEl.value;
    window.buffy
      .setDraft(text)
      .then((result) => {
        if (result && Number.isFinite(result.revision)) state.draftRevision = result.revision;
      })
      .catch(() => {});
  }

  async function submitHandoff() {
    if (state.handoffInFlight) return;
    const text = draftEl.value;
    if (!text.trim()) {
      composerNoteText('Write something first.', 'error');
      return;
    }
    state.handoffInFlight = true;
    handoffButton.disabled = true;
    handoffButton.textContent = 'Opening…';
    composerNoteText('Handing the draft to Claude Desktop…');
    try {
      const result = await window.buffy.handoff({ text, revision: state.draftRevision });
      if (result?.ok) {
        if (result.cleared) {
          draftEl.value = '';
          state.draftRevision = result.revision ?? state.draftRevision + 1;
        }
        composerNoteText('Opened Claude Desktop with your draft. Review and send it there; Buffy did not send it.');
        showToast('Claude Desktop opened with your draft.');
        state.greetingAt = performance.now();
      } else {
        composerNoteText(
          result?.error ||
            (result?.code === 'TOO_LONG'
              ? 'That draft is too long for a link. Copy it instead.'
              : 'Claude could not be opened. Your draft is still here; copy it to keep working.'),
          'error',
        );
      }
    } catch (error) {
      composerNoteText(`Claude could not be opened. ${error.message || 'Your draft is still here.'}`, 'error');
    } finally {
      state.handoffInFlight = false;
      handoffButton.disabled = false;
      handoffButton.textContent = 'Open in Claude';
    }
  }

  function applyPrefs(next) {
    if (!next?.prefs) {
      if (next?.companion) state.prefs = next;
      return;
    }
    state.prefs = next.prefs;
    applyMode({ mode: next.mode || state.mode, scale: next.scale || 1, dictation: next.dictation });
    scheduler.configure({
      idleHobbies: state.prefs.personality?.idleHobbies !== false,
      sleepAfterMs: state.prefs.personality?.sleepy === false ? 24 * 60 * 60 * 1000 : state.prefs.personality?.sleepAfterMs || 120000,
    });
    BuffyCharacters.preload(characterId()).then(schedulePillLayout, schedulePillLayout);
    document.documentElement.style.setProperty('--accent', BuffyCharacters.themeAccent(look().theme));
    updatePill();
    if (state.cardsOpen) renderCards();
  }

  function applyCatalog(catalog) {
    state.catalog = catalog;
    BuffyCharacters.preload(characterId()).then(schedulePillLayout, schedulePillLayout);
  }

  function applySnapshot(next) {
    if (!next) {
      offline();
      return;
    }
    const now = performance.now();
    const wasOffline = state.offline;
    state.offline = false;
    state.snapshot = next;
    const current = next.current || {};
    const seq = current.seq ?? 0;
    const message = current.message || '';
    if (wasOffline) {
      showToast('Buffy reconnected.');
      scheduler.activity(now);
    }
    if (seq !== state.lastSeq || message !== state.lastMessage) {
      state.lastSeq = seq;
      state.lastMessage = message;
      scheduler.activity(now);
      if (message) {
        const sticky = current.state === 'needs-you' || current.state === 'error';
        showBubble(message, current.source, current.observed, sticky);
      } else if (current.state !== 'done') {
        hideBubble();
      }
      if (current.state === 'done' && current.observed === 'inferred') {
        showBubble('Repository activity settled. This is an inference, not a test result.', current.source, 'inferred');
      }
    }
    syncCustomImage(next);
    updatePill(now);
    if (state.cardsOpen) renderCards();
    if (state.mode === 'compact') updateBadges();
  }

  function offline() {
    state.offline = true;
    state.snapshot = null;
    state.lastSeq = null;
    state.lastMessage = '';
    app.dataset.state = 'offline';
    pillState.textContent = 'Offline';
    pillPending.hidden = true;
    toolbarPending.hidden = true;
    compactBadge.hidden = true;
    hideBubble();
    showToast('Buffy’s local daemon is offline. Reconnecting…');
    renderCards();
  }

  function syncCustomImage(snapshot) {
    const sprite = snapshot?.pet?.sprite;
    const port = snapshot?.port;
    if (!sprite || sprite.type !== 'image' || !port) {
      state.customImage = null;
      state.customKey = '';
      return;
    }
    const key = `${sprite.id || sprite.file}|${port}`;
    if (key === state.customKey) return;
    state.customKey = key;
    state.customImage = null;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (state.customKey !== key) return;
      state.customImage = image;
      schedulePillLayout();
    };
    image.src = `http://127.0.0.1:${port}/sprite?v=${encodeURIComponent(sprite.id || Date.now())}`;
  }

  function setIgnoreMouse(ignore) {
    if (state.lastIgnore === ignore) return;
    state.lastIgnore = ignore;
    window.buffy.setIgnoreMouse(ignore);
  }

  function spawnTrail(moveX, moveY) {
    if (personality().reducedMotion) return;
    const now = performance.now();
    state.trail.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 70,
      y: window.innerHeight - 110 + (Math.random() - 0.5) * 40,
      vx: Math.max(-18, Math.min(18, -moveX * 0.25)) + (Math.random() - 0.5) * 3,
      vy: -8 - Math.random() * 8,
      bornAt: now,
      ttl: 520 + Math.random() * 220,
      size: 2.4 + Math.random() * 2,
      kind: Math.random() < 0.5 ? 'heart' : 'sparkle',
      color: Math.random() < 0.5 ? '#f0a3bf' : '#f6cf7d',
    });
    if (state.trail.length > 28) state.trail.splice(0, state.trail.length - 28);
  }

  function drawTrail(now) {
    if (!state.trail.length) return;
    state.trail = state.trail.filter((particle) => now - particle.bornAt < particle.ttl);
    for (const particle of state.trail) {
      const progress = (now - particle.bornAt) / particle.ttl;
      const ease = 1 - (1 - progress) * (1 - progress);
      const x = particle.x + particle.vx * ease;
      const y = particle.y + particle.vy * ease;
      if (particle.kind === 'heart') {
        BuffyCharacters.drawHeart(ctx, x, y, particle.size * 1.6, (1 - progress) * 0.7, particle.color);
      } else {
        BuffyCharacters.drawSparkle(ctx, x, y, particle.size, particle.color, (1 - progress) * 0.75);
      }
    }
  }

  function frame(now) {
    state.frameId = null;
    if (!state.visible) return;
    state.frameId = requestAnimationFrame(frame);
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    const base = baseState();
    const busy =
      state.offline ||
      base !== 'idle' ||
      state.composerOpen ||
      state.cardsOpen ||
      state.hovered ||
      state.draftRevision > 0 && state.composerOpen;
    const hobby = scheduler.update(now, { hovered: state.hovered, busy });
    const local = localState(now);
    const startedAt = Number(state.snapshot?.current?.since);
    const waiting =
      local === 'working' &&
      currentCategory() !== 'compacting' &&
      Number.isFinite(startedAt) &&
      Date.now() - startedAt > 60_000;
    const celebrating = state.celebrateAt > 0 && now - state.celebrateAt < 4200;
    const greeting = local === 'idle' && now - state.greetingAt < 1600 && personality().returnGreetings !== false && pendingCount() === 0;
    if (local === 'idle' && personality().extraIdleGestures !== false && now - state.lastGestureAt > 78_000) {
      state.lastGestureAt = now;
      if (Math.random() < 0.5) state.greetingAt = now;
    }
    if (local === 'idle' && personality().extraIdleGestures === false) state.lastGestureAt = now;

    BuffyCharacters.draw(ctx, {
      characterId: characterId(),
      look: look(),
      clothing: clothing(),
      state: local,
      category: currentCategory(),
      hobby: local === 'idle' ? hobby : null,
      now,
      width,
      height,
      baseY: height - (state.mode === 'compact' ? 24 : 44),
      compact: state.mode === 'compact',
      cursor: state.cursor,
      reducedMotion: personality().reducedMotion === true,
      thoughtBubbles: personality().thoughtBubbles || 'off',
      greeting,
      pending: pendingCount(),
      waiting,
      celebration: celebrating,
      customImage: state.customImage,
    });
    drawTrail(now);
    updatePillTop(local);
    if (state.bubbleUntil && now > state.bubbleUntil) hideBubble();
    if (now - state.lastPillAt > 500) {
      state.lastPillAt = now;
      updatePill(now);
    }
  }

  function startFrames() {
    if (!state.frameId && state.visible) state.frameId = requestAnimationFrame(frame);
  }

  function stopFrames() {
    if (state.frameId) cancelAnimationFrame(state.frameId);
    state.frameId = null;
  }

  function wake(now = performance.now()) {
    scheduler.activity(now);
  }

  async function petCompanion() {
    wake();
    try {
      const result = await window.buffy.pet();
      if (!result?.ok) {
        showToast('Buffy’s daemon is offline; the pet could not react.');
        return;
      }
      state.petAt = performance.now();
      state.greetingAt = performance.now();
      scheduler.activity(performance.now());
      showBubble('That tickles!', 'you', 'explicit', false, 1900);
    } catch {
      showToast('Buffy’s daemon is offline; the pet could not react.');
    }
  }

  function openClaude() {
    window.buffy.openClaude().catch(() => showToast('Claude could not be opened.'));
  }

  function wireToolbar() {
    toolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-action]');
      if (!button) return;
      event.preventDefault();
      switch (button.dataset.action) {
        case 'compose':
          if (state.composerOpen) closeComposer();
          else openComposer();
          break;
        case 'activity':
          if (state.cardsOpen) closeCards();
          else openCards();
          break;
        case 'pet':
          petCompanion();
          break;
        case 'dictate':
          showToast(state.dictationReason || 'Local dictation is unavailable on this system.');
          break;
        case 'compact':
          requestMode(state.mode === 'compact' ? 'full' : 'compact');
          break;
        case 'settings':
          window.buffy.openSettings();
          break;
        default:
          break;
      }
    });
  }

  function wireComposer() {
    composeEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    composeEl.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    composeEl.addEventListener('click', (event) => {
      const close = event.target.closest?.('[data-action="close-composer"]');
      if (close) closeComposer();
    });
    draftEl.addEventListener('input', () => {
      composerNoteText('');
      composeDraftToMain();
    });
    draftEl.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeComposer();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitHandoff();
      }
    });
    handoffButton.addEventListener('click', submitHandoff);
    copyDraft.addEventListener('click', async () => {
      await window.buffy.copy(draftEl.value);
      composerNoteText('Draft copied. It was not sent.');
      showToast('Draft copied.');
    });
  }

  function wireCards() {
    cardsEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    cardsEl.addEventListener('click', async (event) => {
      const close = event.target.closest?.('[data-action="close-cards"]');
      if (close) {
        closeCards();
        return;
      }
      const tab = event.target.closest?.('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        renderCards();
        return;
      }
      const snooze = event.target.closest?.('[data-snooze]');
      if (snooze) {
        const duration = Number(snooze.dataset.snooze) || 0;
        try {
          const result = await window.buffy.snooze(duration);
          if (result?.ok) {
            if (result.prefs) applyPrefs({ prefs: result.prefs, mode: state.mode, scale: state.scale });
            showToast(duration ? `Notifications snoozed for ${duration >= 3600000 ? `${Math.round(duration / 3600000)}h` : `${Math.round(duration / 60000)}m`}. Pending requests stay visible.` : 'Snooze cleared.');
          } else {
            showToast(result?.error || 'Could not change snooze.');
          }
        } catch {
          showToast('Could not change snooze.');
        }
        return;
      }
      const action = event.target.closest?.('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'open-claude') {
        openClaude();
        return;
      }
      if (action.dataset.action === 'focus-session') {
        action.disabled = true;
        try {
          const result = await window.buffy.focusSession({
            sessionId: action.dataset.session,
            cwd: action.dataset.cwd,
          });
          if (result?.ok && result.opened === 'folder') {
            showToast(`Opened ${String(result.path).split(/[\\/]/).filter(Boolean).pop() || 'the project folder'}.`);
          } else if (result?.ok) {
            showToast('Session id copied. This session did not report a folder.');
          } else {
            showToast(result?.error || 'That session has no folder to open.');
          }
        } catch {
          showToast('That session has no folder to open.');
        }
        action.disabled = false;
        return;
      }
      if (action.dataset.action === 'dismiss') {
        const sessionId = action.dataset.session;
        action.disabled = true;
        action.textContent = '…';
        try {
          const result = await window.buffy.dismissSession(sessionId);
          if (!result?.ok) {
            showToast(result?.error || 'That session could not be dismissed.');
            action.disabled = false;
            action.textContent = 'Dismiss';
          }
        } catch {
          showToast('That session could not be dismissed.');
          action.disabled = false;
          action.textContent = 'Dismiss';
        }
      }
    });
    cardsTabs.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  function wireHit() {
    hit.addEventListener('pointerenter', () => {
      state.hovered = true;
      wake();
    });
    hit.addEventListener('pointerleave', () => {
      state.hovered = false;
    });
    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      wake();
      state.pointer = {
        startX: event.screenX,
        startY: event.screenY,
        lastX: event.screenX,
        lastY: event.screenY,
        lastTrailAt: 0,
        moved: false,
      };
      hit.setPointerCapture?.(event.pointerId);
      window.buffy.dragStart(event.screenX, event.screenY);
      setIgnoreMouse(false);
    });
    hit.addEventListener('pointermove', (event) => {
      const pointer = state.pointer;
      if (!pointer) return;
      event.stopPropagation();
      const moveX = event.screenX - pointer.lastX;
      const moveY = event.screenY - pointer.lastY;
      pointer.lastX = event.screenX;
      pointer.lastY = event.screenY;
      if (!pointer.moved && Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) > 4) {
        pointer.moved = true;
        document.body.classList.add('dragging');
      }
      if (pointer.moved) {
        const now = performance.now();
        if (now - pointer.lastTrailAt > 34 && (moveX || moveY)) {
          pointer.lastTrailAt = now;
          spawnTrail(moveX, moveY);
        }
        window.buffy.dragMove(event.screenX, event.screenY);
      }
    });
    const finish = (event) => {
      const pointer = state.pointer;
      if (!pointer) return;
      state.pointer = null;
      document.body.classList.remove('dragging');
      try {
        hit.releasePointerCapture?.(event.pointerId);
      } catch {
        /* pointer already released */
      }
      window.buffy.dragEnd();
      if (!pointer.moved) petCompanion();
    };
    hit.addEventListener('pointerup', finish);
    hit.addEventListener('pointercancel', (event) => {
      if (!state.pointer) return;
      state.pointer = null;
      document.body.classList.remove('dragging');
      window.buffy.dragEnd();
      if (event?.pointerId != null) {
        try {
          hit.releasePointerCapture?.(event.pointerId);
        } catch {
          /* ignore */
        }
      }
    });
    hit.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        petCompanion();
      }
    });
  }

  function wireGlobal() {
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', (event) => {
      wake();
      state.cursor = { x: event.clientX, y: event.clientY };
      const interactive = Boolean(
        state.composerOpen ||
          state.cardsOpen ||
          state.pointer ||
          event.target.closest?.('[data-interactive]'),
      );
      setIgnoreMouse(!interactive);
    });
    document.addEventListener('pointerleave', () => {
      state.hovered = false;
      if (!state.composerOpen && !state.cardsOpen && !state.pointer) setIgnoreMouse(true);
    });
    document.addEventListener('contextmenu', (event) => {
      if (event.target.closest?.('textarea, .cards-body')) return;
      event.preventDefault();
      window.buffy.menu();
    });
    document.addEventListener('keydown', (event) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('textarea, input');
      if (event.key === 'Escape') {
        if (state.composerOpen) {
          event.preventDefault();
          closeComposer();
        } else if (state.cardsOpen) {
          event.preventDefault();
          closeCards();
        }
        return;
      }
      if (typing) return;
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        if (state.composerOpen) closeComposer();
        else openComposer();
      } else if (event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        if (state.cardsOpen) closeCards();
        else openCards();
      }
    });
  }

  function wireBridge() {
    window.buffy.onState(applySnapshot);
    window.buffy.onOffline(offline);
    window.buffy.onCursor((point) => {
      if (!point) return;
      state.cursor = point;
      const inside = point.x >= 0 && point.x <= window.innerWidth && point.y >= 0 && point.y <= window.innerHeight;
      if (inside) wake();
    });
    window.buffy.onPrefs(applyPrefs);
    window.buffy.onCatalog(applyCatalog);
    window.buffy.onToast((text) => showToast(text));
    window.buffy.onDraft((draft) => {
      if (!draft) return;
      state.draftRevision = draft.revision || state.draftRevision;
      if (typeof draft.text === 'string' && draft.text !== draftEl.value) draftEl.value = draft.text;
    });
    window.buffy.onMode(applyMode);
    window.buffy.onChime((payload) => playChime(payload?.volume));
    window.buffy.onVisibility((visible) => {
      const wasHidden = !state.visible;
      state.visible = Boolean(visible);
      if (state.visible) {
        const now = performance.now();
        scheduler.activity(now);
        if (wasHidden && personality().returnGreetings !== false && baseState() === 'idle') state.greetingAt = now;
        startFrames();
      } else {
        stopFrames();
      }
    });
    window.buffy.onSummon(async () => {
      const now = performance.now();
      state.greetingAt = now;
      await openComposer();
      if (!draftEl.value) composerNoteText('Buffy is ready for a prompt. Nothing is sent until you send it in Claude.');
    });
    window.buffy.onOpenPanel((panel) => {
      if (panel === 'cards') openCards();
      if (panel === 'compose') openComposer();
    });
    window.buffy.onUpdate((update) => {
      if (!update) return;
      if (update.kind === 'ready') showToast(`Buffy ${update.version} is ready. Restart from Settings or the tray when you are not mid-draft.`);
      if (update.kind === 'deferred') showToast('Update deferred until your draft, dictation, or handoff is finished.');
    });
  }

  async function init() {
    resize();
    wireToolbar();
    wireComposer();
    wireCards();
    wireHit();
    wireGlobal();
    wireBridge();
    try {
      const snapshot = await window.buffy.getSnapshot();
      if (snapshot) applySnapshot(snapshot);
    } catch {
      /* the stream will reconnect */
    }
    const mode = await window.buffy.requestMode(state.mode).catch(() => null);
    if (mode) applyMode(mode);
    startFrames();
  }

  init();
})();
