/* global window, document, performance, requestAnimationFrame, BuffyCharacters */
(function settingsApp() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const title = $('section-title');
  const eyebrow = $('section-eyebrow');
  const saveState = $('save-state');
  const preview = $('preview');
  const previewName = $('preview-name');
  const previewLook = $('preview-look');
  const poseButtons = $('pose-buttons');
  const toastEl = $('settings-toast');

  const SECTIONS = {
    companion: { title: 'Companion & wardrobe', eyebrow: 'Make her yours' },
    personality: { title: 'Personality', eyebrow: 'How she spends quiet time' },
    shortcuts: { title: 'Shortcuts', eyebrow: 'Call her from anywhere' },
    alerts: { title: 'Alerts', eyebrow: 'Only when you want them' },
    connection: { title: 'Connection', eyebrow: 'Where the signals come from' },
    updates: { title: 'Updates', eyebrow: 'Keep her current' },
  };

  const POSE_STATE = {
    idle: { state: 'idle' },
    typingLeft: { state: 'working', poseOverride: 'typingLeft', category: 'editing' },
    typingRight: { state: 'working', poseOverride: 'typingRight', category: 'editing' },
    happy: { state: 'done' },
    wave: { state: 'wave' },
    sleepy: { state: 'sleepy' },
    reading: { state: 'working', poseOverride: 'reading', category: 'reading' },
    tea: { state: 'idle', hobby: { id: 'tea' }, poseOverride: 'tea' },
    gardening: { state: 'idle', hobby: { id: 'gardening' }, poseOverride: 'gardening' },
  };

  const CLOTHING_LABELS = {
    outfit: 'Outfit',
    bow: 'Bow',
    hat: 'Hat',
    glasses: 'Glasses',
    wand: 'Wand',
  };

  let data = null;
  let prefs = null;
  let catalog = null;
  let characterId = 'buffy';
  let section = 'companion';
  let pose = 'idle';
  let saveTimer = null;
  let toastTimer = null;
  let frameId = null;
  let renamingId = null;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function toast(message) {
    toastEl.textContent = String(message || '');
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3600);
  }

  function character() {
    return catalog?.characters?.find((entry) => entry.id === characterId) || catalog?.characters?.[0] || null;
  }

  function characterPrefs() {
    if (!prefs.characters[characterId]) {
      prefs.characters[characterId] = {
        look: { outfit: 'none', bow: 'none', hat: 'none', glasses: 'none', wand: 'none', theme: 'plum' },
        clothing: { outfit: true, bow: true, hat: true, glasses: true, wand: true },
        favorites: [],
        looks: [],
        rotation: { enabled: false },
      };
    }
    return prefs.characters[characterId];
  }

  function currentLook() {
    return characterPrefs().look || {};
  }

  function allowed(slotId) {
    const char = character();
    const slot = catalog.slots.find((entry) => entry.id === slotId);
    if (!slot || !char) return [];
    const ids =
      slotId === 'outfit'
        ? char.outfits || ['none']
        : slotId === 'theme'
          ? char.themes || ['plum']
          : char.accessories?.[slotId] || ['none'];
    return slot.items.filter((item) => ids.includes(item.id));
  }

  function swatchStyle(swatch) {
    if (Array.isArray(swatch)) return `background:linear-gradient(135deg, ${swatch[0]}, ${swatch[1] || swatch[0]})`;
    if (!swatch || swatch === 'transparent') return 'background:transparent';
    return `background:${swatch}`;
  }

  function lookForCharacter(id) {
    const char = catalog.characters.find((entry) => entry.id === id);
    return {
      outfit: char?.defaultLook?.outfit || 'none',
      bow: char?.defaultLook?.bow || 'none',
      hat: char?.defaultLook?.hat || 'none',
      glasses: char?.defaultLook?.glasses || 'none',
      wand: char?.defaultLook?.wand || 'none',
      theme: char?.defaultLook?.theme || 'plum',
    };
  }

  function setLocal(nextPrefs) {
    if (!nextPrefs) return;
    prefs = nextPrefs;
    if (prefs.companion?.characterId) characterId = prefs.companion.characterId;
    saveState.textContent = 'Saved locally';
  }

  async function action(type, payload = {}) {
    try {
      const result = await window.buffySettings.action(type, payload);
      if (result?.prefs) setLocal(result.prefs);
      if (result?.connection) data.connection = result.connection;
      if (result?.shortcut) data.shortcut = result.shortcut;
      if (result?.update) data.update = { ...data.update, ready: result.update, deferred: result.deferred };
      if (!result?.ok && result?.error) toast(result.error);
      return result;
    } catch (error) {
      toast(error.message || 'That change could not be saved.');
      return { ok: false, error: error.message };
    }
  }

  function scheduleSave() {
    saveState.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const result = await action('save', { prefs });
      if (result?.ok) saveState.textContent = 'Saved locally';
    }, 320);
  }

  function toggleRow(id, label, description, checked, attrs = '') {
    return `<div class="toggle-row">
      <div><strong>${esc(label)}</strong><small>${esc(description)}</small></div>
      <label class="switch"><input type="checkbox" id="${esc(id)}" ${checked ? 'checked' : ''} ${attrs} /><span aria-hidden="true"></span></label>
    </div>`;
  }

  function card(titleText, hint, body, extra = '') {
    return `<section class="card">
      <h2>${esc(titleText)}</h2>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      ${body}
      ${extra}
    </section>`;
  }

  function renderCompanion() {
    const char = character();
    const cp = characterPrefs();
    const looks = cp.looks || [];
    const savedCount = looks.length;
    const rotation = cp.rotation || {};
    const builtins = (catalog.builtinPresets || []).filter(
      (preset) => !preset.characterId || preset.characterId === characterId,
    );
    const slotHtml = catalog.slots
      .map((slot) => {
        const items = allowed(slot.id);
        return `<div class="slot">
          <div class="slot-head"><strong>${esc(slot.label)}</strong><small>${esc(slot.description || '')}</small></div>
          <div class="chips">
            ${items
              .map(
                (item) =>
                  `<button type="button" class="chip" data-slot="${esc(slot.id)}" data-value="${esc(item.id)}" aria-pressed="${currentLook()[slot.id] === item.id}"><i style="${swatchStyle(item.swatch)}"></i>${esc(item.label)}</button>`,
              )
              .join('')}
          </div>
        </div>`;
      })
      .join('');

    const lookRows = [...builtins, ...looks]
      .map((look) => {
        const saved = !look.builtin;
        const favorite = (cp.favorites || []).includes(look.id);
        const renaming = renamingId === look.id;
        return `<div class="look-row">
          ${renaming ? `<input id="rename-input" type="text" maxlength="40" value="${esc(look.name)}" aria-label="New look name" />` : `<strong>${esc(look.name)}</strong>`}
          <small>${look.builtin ? 'built in' : 'saved'}</small>
          <span class="grow"></span>
          ${
            renaming
              ? `<button type="button" class="mini" data-rename-save="${esc(look.id)}">Save name</button><button type="button" class="mini" data-rename-cancel>Cancel</button>`
              : `<button type="button" class="mini" data-look-favorite="${esc(look.id)}" aria-pressed="${favorite}" title="Favorite">${favorite ? '★' : '☆'}</button>
                 <button type="button" class="mini" data-look-wear="${esc(look.id)}">Wear</button>
                 ${
                   saved
                     ? `<label class="mini" title="Include in daily rotation"><input type="checkbox" data-look-rotation="${esc(look.id)}" ${look.includeInRotation !== false ? 'checked' : ''}/> daily</label>
                        <button type="button" class="mini" data-look-rename="${esc(look.id)}">Rename</button>
                        <button type="button" class="mini" data-look-replace="${esc(look.id)}">Replace</button>
                        <button type="button" class="mini danger" data-look-delete="${esc(look.id)}">Delete</button>`
                     : ''
                 }`
          }
        </div>`;
      })
      .join('');

    panel.innerHTML = [
      card(
        'Who lives on your desktop',
        'A name and pronouns for the pill, the speech bubble, and the onboarding copy.',
        `<div class="field-grid">
          <div class="field"><label for="companion-name">Name</label><input id="companion-name" type="text" maxlength="32" value="${esc(prefs.companion.name)}" data-companion="name" /></div>
          <div class="field"><label for="companion-pronouns">Pronouns</label><input id="companion-pronouns" type="text" maxlength="24" value="${esc(prefs.companion.pronouns)}" data-companion="pronouns" /></div>
        </div>
        <div class="character-grid" style="margin-top:12px">
          ${catalog.characters
            .map(
              (entry) => `<button type="button" class="character" data-character="${esc(entry.id)}" aria-pressed="${entry.id === characterId}">
                <span class="character-orb" aria-hidden="true">${entry.renderer === 'atlas' ? '❀' : '☁'}</span>
                <span><strong>${esc(entry.name)}</strong><small>${esc(entry.tagline || '')}</small></span>
              </button>`,
            )
            .join('')}
        </div>
        <p class="hint" style="margin-bottom:0">${char ? esc(char.tagline || '') : ''}</p>`,
      ),
      card(
        'Wardrobe',
        'Outfits are drawn to the same anchors across all nine poses. Each piece can be switched off independently.',
        `${slotHtml}
        <div class="row-actions"><button type="button" class="button" data-random>Surprise me</button><span class="hint" style="margin:0">Favorites get a gentle bias.</span></div>`,
      ),
      card(
        'Clothing switches',
        'Turning a piece off keeps it in your saved looks; it just does not render right now.',
        Object.keys(CLOTHING_LABELS)
          .map((key) => {
            const checked = cp.clothing?.[key] !== false;
            return `<div class="toggle-row"><div><strong>${esc(CLOTHING_LABELS[key])}</strong><small>${checked ? 'Visible' : 'Hidden without deleting the look'}</small></div><label class="switch"><input type="checkbox" data-clothing="${key}" ${checked ? 'checked' : ''} /><span aria-hidden="true"></span></label></div>`;
          })
          .join(''),
      ),
      card(
        'Saved looks',
        `Save the current combination, give it a name, and include it in the daily rotation. ${savedCount} / 32 saved for ${esc(char?.name || 'this character')}.`,
        `<div class="looks-list">${lookRows || '<p class="empty">No looks yet. Build one above and save it below.</p>'}</div>
        <div class="inline-input"><input id="look-name" type="text" maxlength="40" placeholder="Name this look" /><button type="button" class="button primary" data-save-look>Save current look</button></div>
        <p class="note rose">Daily rotation starts on the next local day after you enable it, and never replaces a manual change made today.</p>`,
      ),
      card(
        'Daily rotation',
        'Prefer a different outfit each day? Rotation only runs while Buffy is resting and skips looks whose art is unavailable.',
        toggleRow('rotation-enabled', 'Rotate daily', 'Pick a different saved or built-in look each day.', rotation.enabled === true, 'data-rotation="enabled"') +
          `<p class="note">${rotation.enabled ? `Enabled ${esc(rotation.enabledOn || 'today')}. Last rotation: ${esc(rotation.lastRotatedDay || 'not yet')}.` : 'Off. Your current look stays put.'}</p>`,
      ),
    ].join('');
  }

  function renderPersonality() {
    const p = prefs.personality;
    panel.innerHTML = [
      card(
        'Quiet company',
        'These are presentation preferences, not a second activity model. They never change what the agents report.',
        toggleRow('idle-hobbies', 'Idle hobbies', 'Tea, reading, and a little gardening when there is no work.', p.idleHobbies !== false, 'data-personality="idleHobbies"') +
          toggleRow('extra-gestures', 'Extra idle gestures', 'An occasional wave or stretch while resting.', p.extraIdleGestures !== false, 'data-personality="extraIdleGestures"') +
          toggleRow('return-greetings', 'Return greetings', 'A small wave when Buffy comes back after being hidden or summoned.', p.returnGreetings !== false, 'data-personality="returnGreetings"') +
          toggleRow('sleepy', 'Sleep when idle', 'Close her eyes after the quiet timeout instead of staying awake forever.', p.sleepy !== false, 'data-personality="sleepy"') +
          toggleRow('reduced-motion', 'Reduce motion', 'Keep bobbing, blinking, and celebration sparkles still.', p.reducedMotion === true, 'data-personality="reducedMotion"'),
      ),
      card(
        'Thought bubbles',
        'Optional labels above her head. Requests and errors always use the pill and activity cards instead.',
        `<div class="field"><label for="thought-bubbles">Bubble style</label>
          <select id="thought-bubbles" data-personality-select="thoughtBubbles">
            <option value="off" ${p.thoughtBubbles === 'off' ? 'selected' : ''}>Off</option>
            <option value="emoji" ${p.thoughtBubbles === 'emoji' ? 'selected' : ''}>Emoji</option>
            <option value="words" ${p.thoughtBubbles === 'words' ? 'selected' : ''}>Words</option>
          </select>
        </div>
        <div class="field" style="margin-top:12px"><label for="sleep-after">Sleep after <span id="sleep-value">${Math.round((p.sleepAfterMs || 120000) / 60000)} min</span></label>
          <input id="sleep-after" type="range" min="30000" max="600000" step="30000" value="${p.sleepAfterMs || 120000}" data-sleep />
        </div>`,
      ),
      card(
        'Reactions',
        'Reply reactions are off by default and only use transient presentation categories. They are never stored as personality data or agent results.',
        toggleRow('reply-reactions', 'Reply reactions', 'A tiny happy reaction when a turn completes.', p.replyReactions === true, 'data-personality="replyReactions"') +
          '<p class="note">No reaction is inferred from a test result or file change unless the agent explicitly reported it.</p>',
      ),
    ].join('');
  }

  function renderShortcuts() {
    const shortcut = data.shortcut || {};
    panel.innerHTML = [
      card(
        'Summon Buffy',
        'Reveal and focus the composer from anywhere. If a draft already exists, it is focused and preserved; nothing is recorded or sent.',
        `<div class="field"><label for="summon-shortcut">Global shortcut</label>
          <input id="summon-shortcut" type="text" maxlength="80" value="${esc(shortcut.accelerator || prefs.shortcuts.summon)}" spellcheck="false" />
        </div>
        <div class="row-actions"><button type="button" class="button primary" data-save-shortcut>Save shortcut</button><button type="button" class="button" data-reset-shortcut>Use default</button></div>
        <div class="status" data-state="${shortcut.ok ? 'connected' : 'error'}"><span class="status-dot"></span><span>${esc(shortcut.ok ? 'Registered with the desktop.' : shortcut.error || 'Not registered yet.')}</span></div>`,
      ),
      card(
        'Keyboard',
        'Local shortcuts only work while Buffy is focused.',
        `<div class="kv"><span>Compose</span><strong>C</strong><span>Activity</span><strong>A</strong><span>Send draft</span><strong>Ctrl / Cmd + Enter</strong><span>Close panel</span><strong>Esc</strong></div>
        <p class="hint" style="margin-bottom:0">Clicking the character pets her. Dragging the character moves the window.</p>`,
      ),
    ].join('');
  }

  function renderAlerts() {
    const a = prefs.alerts || {};
    const snoozed = a.snoozeUntil && Date.parse(a.snoozeUntil) > Date.now();
    panel.innerHTML = [
      card(
        'Notifications',
        'Everything is opt-in. Alerts are deduplicated, so polling, startup, and reconnects never replay old requests.',
        toggleRow('alert-requests', 'Permission requests and questions', 'A notification when a session explicitly needs you.', a.requests === true, 'data-alert="requests"') +
          toggleRow('alert-completions', 'Completed turns', 'A notification when an agent explicitly reports completion.', a.completions === true, 'data-alert="completions"') +
          toggleRow('alert-sounds', 'Play a soft sound', 'Uses the operating system beep. Independent of visual alerts.', a.sounds === true, 'data-alert="sounds"') +
          `<p class="note">${data.notificationsSupported ? 'Desktop notifications are supported on this computer.' : 'Desktop notifications are unavailable on this system; the activity cards and pending badge still update.'}</p>`,
      ),
      card(
        'Snooze',
        'Snoozing suppresses delivery, not state. Pending requests stay visible in the pill and activity panel.',
        `<div class="row-actions">
          <button type="button" class="button" data-snooze="900000">15 minutes</button>
          <button type="button" class="button" data-snooze="3600000">1 hour</button>
          <button type="button" class="button" data-snooze="14400000">4 hours</button>
          <button type="button" class="button" data-snooze="0">Turn off snooze</button>
        </div>
        <p class="note">${snoozed ? `Snoozed until ${esc(new Date(a.snoozeUntil).toLocaleTimeString())}.` : 'Not snoozed.'} Suppressed events are marked seen and never delivered later.</p>`,
      ),
      card(
        'What is never an alert',
        'Idle reminders are information, not a request. A repository watcher settlement is inferred, not a test result.',
        '<p class="hint" style="margin-bottom:0">Inferred completions never produce a completion notification. Explicit permission prompts and questions do, when enabled.</p>',
      ),
    ].join('');
  }

  function connectionLabel(state) {
    return {
      connected: 'Connected',
      installed: 'Installed, waiting for an event',
      repair: 'Needs repair',
      'not-installed': 'Not connected',
      disabled: 'Claude hooks are disabled',
      error: 'Connection error',
      unknown: 'Checking',
    }[state] || 'Unknown';
  }

  function renderConnection() {
    const connection = data.connection || {};
    const health = data.health;
    const watch = data.watch;
    panel.innerHTML = [
      card(
        'Claude Code',
        'The packaged helper installs a stable launcher in your Buffy folder and merges hooks into your user-level Claude Code settings. It preserves unrelated hooks, respects disableAllHooks, and never blocks Claude.',
        `<div class="status" data-state="${esc(connection.state || 'unknown')}">
          <span class="status-dot"></span>
          <span><strong>${esc(connectionLabel(connection.state))}.</strong> ${esc(connection.detail || '')}</span>
        </div>
        <div class="kv">
          <span>Settings</span><strong class="mono">${esc(connection.settingsPath || '—')}</strong>
          <span>Launcher</span><strong class="mono">${esc(connection.launcher || '—')}</strong>
          <span>Last hook</span><strong>${connection.lastHookAt ? esc(new Date(connection.lastHookAt).toLocaleString()) : 'No event observed yet'}</strong>
        </div>
        <div class="row-actions">
          <button type="button" class="button primary" data-connection="install">${connection.state === 'not-installed' ? 'Connect Claude Code' : 'Repair connection'}</button>
          <button type="button" class="button" data-connection="check">Check again</button>
          <button type="button" class="button" data-connection="uninstall">Remove hooks</button>
        </div>
        <p class="note">Installing only writes the hook configuration. A successful install does not prove an event has arrived; “Connected” requires a recent hook event.</p>`,
      ),
      card(
        'Freebuff watcher',
        'Freebuff has no hook stream. Buffy watches the project for file activity and labels those events as inferred.',
        toggleRow('watcher', 'Watch repository activity', 'Working and settled states from local file changes.', prefs.connection.freebuffWatcher !== false, 'data-watcher') +
          '<p class="note rose">Inferred activity never becomes a permission request and never produces a completion notification.</p>',
      ),
      card(
        'Local daemon',
        'Buffy keeps state on your computer and serves it over loopback only.',
        `<div class="status" data-state="${health?.ok ? 'connected' : 'error'}"><span class="status-dot"></span><span>${health?.ok ? `Online on 127.0.0.1:${esc(health.port)} (v${esc(health.version)}).` : 'The local daemon is offline. It will restart with Buffy.'}</span></div>
        <div class="kv">
          <span>Watcher</span><strong>${watch?.enabled ? esc(watch.directory) : esc(watch?.reason || 'starting')}</strong>
          <span>Quiet window</span><strong>${watch?.quietMs ? `${Math.round(watch.quietMs / 1000)}s` : '—'}</strong>
          <span>Pending</span><strong>${esc(health?.pendingRequests ?? 0)} request(s)</strong>
        </div>
        <div class="row-actions"><button type="button" class="button" data-restart-daemon>Restart daemon</button></div>`,
      ),
      card(
        'Dictation',
        'Buffy will only add dictation when it can run on-device. There is no silent cloud fallback.',
        `<p class="hint" style="margin-bottom:0">${esc(data.dictation?.reason || 'Local dictation is unavailable. Typing and the clipboard fallback still work.')}</p>`,
      ),
      card(
        'Documentation',
        'Setup, Claude hook details, Freebuff inference, and packaging notes live in the README.',
        '<div class="row-actions"><button type="button" class="button" data-docs>Open setup guide</button></div>',
      ),
    ].join('');
  }

  function renderUpdates() {
    const update = data.update || {};
    panel.innerHTML = [
      card(
        'Installed version',
        'Updates are downloaded from the release channel. Buffy never installs an update in the middle of a draft or handoff.',
        `<div class="kv">
          <span>Current</span><strong>v${esc(data.version)}</strong>
          <span>Build</span><strong>${update.packaged ? 'Installed release' : 'Development checkout'}</strong>
          <span>Update</span><strong>${update.ready ? `v${esc(update.version)} ready` : 'No update ready'}</strong>
        </div>
        <div class="row-actions">
          <button type="button" class="button" data-check-update>Check for updates</button>
          <button type="button" class="button primary" data-install-update ${update.ready ? '' : 'disabled'}>Restart and install</button>
        </div>
        <p class="note">${update.deferred ? 'An update is deferred until your draft, handoff, or dictation is finished. You can still restart explicitly above.' : 'Updates install only when you choose to restart.'}</p>`,
      ),
      card(
        'Update guard',
        'Protect unfinished work. Clearing the draft or closing the composer releases the guard; it never auto-installs behind your back.',
        toggleRow('defer-updates', 'Defer while busy', 'Wait for drafts and handoffs to finish before prompting.', prefs.updates.deferWhileBusy !== false, 'data-update="deferWhileBusy"') +
          '<p class="note rose">The update resumes only when you choose Settings → Updates or the tray menu.</p>',
      ),
    ].join('');
  }

  function renderPanel() {
    if (!prefs || !catalog) return;
    if (section === 'companion') renderCompanion();
    else if (section === 'personality') renderPersonality();
    else if (section === 'shortcuts') renderShortcuts();
    else if (section === 'alerts') renderAlerts();
    else if (section === 'connection') renderConnection();
    else renderUpdates();
    renderPreviewMeta();
  }

  function renderPreviewMeta() {
    const char = character();
    previewName.textContent = char?.name || 'Buffy';
    previewLook.replaceChildren();
    for (const [key, value] of Object.entries(currentLook())) {
      const chip = document.createElement('span');
      chip.textContent = `${key}: ${value}`;
      previewLook.append(chip);
    }
  }

  function render() {
    const meta = SECTIONS[section] || SECTIONS.companion;
    title.textContent = meta.title;
    eyebrow.textContent = meta.eyebrow;
    document.querySelectorAll('[data-section]').forEach((button) => {
      if (button.dataset.section === section) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    renderPanel();
  }

  async function wearLook(id) {
    const cp = characterPrefs();
    const all = [...(catalog.builtinPresets || []), ...(cp.looks || [])];
    const found = all.find((entry) => entry.id === id);
    if (!found) {
      toast('That look no longer exists.');
      return;
    }
    const result = await action('look', { characterId, look: found.look });
    if (result?.ok) {
      render();
      toast(`Wearing ${found.name}.`);
    }
  }

  panel.addEventListener('click', async (event) => {
    const characterButton = event.target.closest('[data-character]');
    if (characterButton) {
      const next = characterButton.dataset.character;
      const result = await action('character', { characterId: next });
      if (result?.ok) {
        characterId = next;
        BuffyCharacters.preload(characterId);
        render();
      }
      return;
    }
    const slot = event.target.closest('[data-slot]');
    if (slot) {
      const nextLook = { ...currentLook(), [slot.dataset.slot]: slot.dataset.value };
      const result = await action('look', { characterId, look: nextLook });
      if (result?.ok) render();
      return;
    }
    const random = event.target.closest('[data-random]');
    if (random) {
      const result = await action('random', { characterId });
      if (result?.ok) {
        render();
        toast('A fresh look, just for today.');
      }
      return;
    }
    const saveLook = event.target.closest('[data-save-look]');
    if (saveLook) {
      const name = $('look-name')?.value || '';
      const result = await action('save-look', { characterId, name });
      if (result?.ok) {
        render();
        toast('Look saved.');
      }
      return;
    }
    const favorite = event.target.closest('[data-look-favorite]');
    if (favorite) {
      const result = await action('favorite', { characterId, id: favorite.dataset.lookFavorite });
      if (result?.ok) render();
      return;
    }
    const wear = event.target.closest('[data-look-wear]');
    if (wear) {
      await wearLook(wear.dataset.lookWear);
      return;
    }
    const rename = event.target.closest('[data-look-rename]');
    if (rename) {
      renamingId = rename.dataset.lookRename;
      render();
      $('rename-input')?.focus();
      $('rename-input')?.select();
      return;
    }
    const renameSave = event.target.closest('[data-rename-save]');
    if (renameSave) {
      const name = $('rename-input')?.value || '';
      const result = await action('rename-look', { characterId, id: renameSave.dataset.renameSave, name });
      if (result?.ok) {
        renamingId = null;
        render();
        toast('Look renamed.');
      }
      return;
    }
    if (event.target.closest('[data-rename-cancel]')) {
      renamingId = null;
      render();
      return;
    }
    const replace = event.target.closest('[data-look-replace]');
    if (replace) {
      if (!window.confirm('Replace this saved look with the current outfit?')) return;
      const result = await action('replace-look', { characterId, id: replace.dataset.lookReplace });
      if (result?.ok) {
        render();
        toast('Saved look replaced.');
      }
      return;
    }
    const remove = event.target.closest('[data-look-delete]');
    if (remove) {
      if (!window.confirm('Delete this saved look? This cannot be undone.')) return;
      const result = await action('delete-look', { characterId, id: remove.dataset.lookDelete });
      if (result?.ok) render();
      return;
    }
    const snooze = event.target.closest('[data-snooze]');
    if (snooze) {
      const result = await action('snooze', { durationMs: Number(snooze.dataset.snooze) || 0 });
      if (result?.ok) render();
      return;
    }
    const connectionButton = event.target.closest('[data-connection]');
    if (connectionButton) {
      const operation = connectionButton.dataset.connection;
      connectionButton.disabled = true;
      connectionButton.textContent = operation === 'install' ? 'Connecting…' : 'Checking…';
      const result = await action('connection', { operation });
      render();
      if (result?.ok) toast(operation === 'install' ? 'Claude Code hooks installed.' : 'Connection checked.');
      else if (result?.skipped) toast(result.notes?.[0] || 'Claude Code has hooks disabled.');
      return;
    }
    const restart = event.target.closest('[data-restart-daemon]');
    if (restart) {
      restart.disabled = true;
      await action('restart-daemon');
      data.health = await window.buffySettings.get().then((next) => next.health).catch(() => data.health);
      render();
      toast('Local daemon restarted.');
      return;
    }
    const check = event.target.closest('[data-check-update]');
    if (check) {
      check.disabled = true;
      const result = await action('check-update');
      render();
      if (result?.ok) toast('Update check started.');
      return;
    }
    const install = event.target.closest('[data-install-update]');
    if (install) {
      const result = await action('install-update');
      if (!result?.ok) toast(result?.error || 'The update could not start.');
      return;
    }
    if (event.target.closest('[data-docs]')) {
      window.buffySettings.openExternal('https://github.com/slayyyyer/buffy#install-and-run');
      return;
    }
    const shortcutSave = event.target.closest('[data-save-shortcut]');
    if (shortcutSave) {
      const accelerator = $('summon-shortcut')?.value || '';
      const result = await action('shortcut', { accelerator });
      if (result?.ok) {
        data.shortcut = result.shortcut;
        toast('Shortcut registered.');
        render();
      }
      return;
    }
    const resetShortcut = event.target.closest('[data-reset-shortcut]');
    if (resetShortcut) {
      const result = await action('shortcut', { accelerator: 'CommandOrControl+Shift+B' });
      if (result?.ok) {
        data.shortcut = result.shortcut;
        render();
      }
    }
  });

  panel.addEventListener('change', async (event) => {
    const target = event.target;
    if (target.matches('[data-clothing]')) {
      const key = target.dataset.clothing;
      const result = await action('clothing', {
        characterId,
        clothing: { [key]: target.checked },
      });
      if (result?.ok) render();
      return;
    }
    if (target.matches('[data-look-rotation]')) {
      const result = await action('rotation-look', {
        characterId,
        id: target.dataset.lookRotation,
        include: target.checked,
      });
      if (result?.ok) render();
      return;
    }
    if (target.matches('[data-rotation]')) {
      const result = await action('rotation', { characterId, enabled: target.checked });
      if (result?.ok) render();
      return;
    }
    if (target.matches('[data-personality]')) {
      prefs.personality[target.dataset.personality] = target.checked;
      scheduleSave();
      return;
    }
    if (target.matches('[data-personality-select]')) {
      prefs.personality[target.dataset.personalitySelect] = target.value;
      scheduleSave();
      return;
    }
    if (target.matches('[data-alert]')) {
      prefs.alerts[target.dataset.alert] = target.checked;
      scheduleSave();
      return;
    }
    if (target.matches('[data-watcher]')) {
      prefs.connection.freebuffWatcher = target.checked;
      scheduleSave();
      toast('Watcher preference saved. Restart the daemon to apply it.');
      return;
    }
    if (target.matches('[data-update]')) {
      prefs.updates[target.dataset.update] = target.checked;
      scheduleSave();
    }
  });

  panel.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches('[data-companion]')) {
      prefs.companion[target.dataset.companion] = target.value;
      if (target.dataset.companion === 'name') previewName.textContent = character()?.name || 'Buffy';
      scheduleSave();
      return;
    }
    if (target.matches('[data-sleep]')) {
      prefs.personality.sleepAfterMs = Number(target.value) || 120000;
      const value = $('sleep-value');
      if (value) value.textContent = `${Math.round(prefs.personality.sleepAfterMs / 60000)} min`;
      scheduleSave();
    }
  });

  poseButtons.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pose]');
    if (!button) return;
    pose = button.dataset.pose;
    poseButtons.querySelectorAll('[data-pose]').forEach((entry) => {
      entry.setAttribute('aria-pressed', String(entry.dataset.pose === pose));
    });
  });

  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      section = button.dataset.section;
      render();
    });
  });

  $('close-settings').addEventListener('click', () => window.buffySettings.close());

  window.buffySettings.onSection((next) => {
    if (!SECTIONS[next]) return;
    section = next;
    render();
  });

  window.buffySettings.onState((next) => {
    if (next.prefs) setLocal(next.prefs);
    if (next.shortcut) data.shortcut = next.shortcut;
    if (next.connection) data.connection = next.connection;
    if (next.update) data.update = { ...data.update, ...next.update };
  });

  function startPreview() {
    const ctx = preview.getContext('2d');
    let lastWidth = 0;
    let lastHeight = 0;
    function loop(now) {
      frameId = requestAnimationFrame(loop);
      if (document.hidden) return;
      const width = preview.clientWidth;
      const height = preview.clientHeight;
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        preview.width = Math.round(width * dpr);
        preview.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, width, height);
      const mapping = POSE_STATE[pose] || POSE_STATE.idle;
      BuffyCharacters.draw(ctx, {
        characterId,
        look: currentLook(),
        clothing: characterPrefs().clothing,
        state: mapping.state,
        category: mapping.category || 'thinking',
        hobby: mapping.hobby || null,
        poseOverride: mapping.poseOverride || (pose === 'happy' || pose === 'wave' ? pose : null),
        now,
        width,
        height,
        baseY: height - 14,
        compact: false,
        cursor: null,
        reducedMotion: false,
        thoughtBubbles: 'off',
        greeting: pose === 'wave',
        pending: 0,
      });
    }
    frameId = requestAnimationFrame(loop);
  }

  async function init() {
    try {
      data = await window.buffySettings.get();
      if (!data?.prefs) throw new Error('Preferences could not be loaded.');
      prefs = data.prefs;
      catalog = data.catalog;
      characterId = prefs.companion.characterId || catalog.characters[0].id;
      $('version').textContent = `Buffy v${data.version}`;
      BuffyCharacters.preload(characterId);
      render();
      startPreview();
      if (data.connection?.state === 'not-installed') {
        setTimeout(() => toast('Claude Code is not connected yet. Open Connection to install the hooks.'), 900);
      }
    } catch (error) {
      panel.innerHTML = `<section class="card"><h2>Settings could not load</h2><p class="hint">${esc(error.message)}</p></section>`;
    }
  }

  init();
})();
