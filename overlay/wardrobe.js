/* global window, document, performance, requestAnimationFrame, BuffyCharacter, BuffyHobbies */
(function wardrobePage() {
  'use strict';

  const api = window.buffyWardrobe;
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');
  const tabsEl = document.getElementById('tabs');
  const panelEl = document.getElementById('panel');
  const statusEl = document.getElementById('status');
  const lookNameEl = document.getElementById('look-name');
  const hobbyEl = document.getElementById('preview-hobbies');
  const surpriseEl = document.getElementById('surprise');

  const TABS = [
    { id: 'looks', label: 'Looks', slots: [] },
    { id: 'outfit', label: 'Outfit', slots: ['outfit'] },
    { id: 'accessories', label: 'Accessories', slots: ['bow', 'hat', 'glasses', 'wand'] },
    { id: 'theme', label: 'Theme', slots: ['theme'] },
  ];
  const SLOTS = ['outfit', 'bow', 'hat', 'glasses', 'wand', 'theme'];
  const PREVIEW_WIDTH = 300;
  const PREVIEW_HEIGHT = 300;
  const PREVIEW_BASE_Y = 280;

  let catalog = null;
  let wardrobe = null;
  let activeTab = 'looks';
  let previewHobby = null;
  let previewStartedAt = performance.now();
  let previewCursor = null;
  let draftName = '';

  function slot(slotId) {
    return catalog.slots.find((entry) => entry.id === slotId);
  }

  function item(slotId, id) {
    const entry = slot(slotId);
    return entry ? entry.items.find((candidate) => candidate.id === id) : null;
  }

  function labelFor(slotId, id) {
    const entry = item(slotId, id);
    return entry ? entry.label : id;
  }

  function lookLabel(look) {
    return `${labelFor('outfit', look.outfit)} · ${labelFor('theme', look.theme)}`;
  }

  function setStatus(text, error = false) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', Boolean(error));
  }

  function swatchNode(value) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.setAttribute('aria-hidden', 'true');
    if (!value || value === 'transparent') {
      swatch.classList.add('swatch-none');
    } else if (Array.isArray(value)) {
      swatch.classList.add('swatch-duo');
      swatch.style.background = `linear-gradient(135deg, ${value[0]}, ${value[1]})`;
    } else {
      swatch.style.background = value;
    }
    return swatch;
  }

  function updateLookName() {
    lookNameEl.textContent = lookLabel(wardrobe);
    canvas.setAttribute('aria-label', `Buffy wearing ${lookLabel(wardrobe)}`);
  }

  function renderTabs() {
    tabsEl.replaceChildren();
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.textContent = tab.label;
      button.dataset.tab = tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === activeTab));
      button.tabIndex = tab.id === activeTab ? 0 : -1;
      button.addEventListener('click', () => {
        activeTab = tab.id;
        render();
      });
      tabsEl.append(button);
    }
  }

  function renderChips(slotId) {
    const entry = slot(slotId);
    const group = document.createElement('section');
    group.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = entry.label;
    const list = document.createElement('div');
    list.className = 'chips';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', entry.label);

    for (const option of entry.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.slot = slotId;
      button.dataset.value = option.id;
      button.setAttribute('aria-pressed', String(wardrobe[slotId] === option.id));
      if (option.hint) button.title = option.hint;
      const label = document.createElement('span');
      label.className = 'chip-label';
      label.textContent = option.label;
      button.append(swatchNode(option.swatch), label);
      list.append(button);
    }
    group.append(heading, list);
    return group;
  }

  function renderLooks() {
    const presets = [...catalog.builtinPresets, ...wardrobe.presets];
    const grid = document.createElement('div');
    grid.className = 'look-grid';
    for (const preset of presets) {
      const card = document.createElement('article');
      card.className = 'look-card';
      card.dataset.preset = preset.id;
      const current = SLOTS.every((key) => preset.look[key] === wardrobe[key]);
      if (current) card.classList.add('current');

      const top = document.createElement('div');
      top.className = 'look-top';
      const name = document.createElement('strong');
      name.textContent = preset.name;
      top.append(name);
      if (current) {
        const badge = document.createElement('span');
        badge.className = 'look-badge';
        badge.textContent = 'Current';
        top.append(badge);
      }

      const meta = document.createElement('small');
      meta.textContent = lookLabel(preset.look);

      const actions = document.createElement('div');
      actions.className = 'look-actions';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.dataset.action = 'apply';
      apply.dataset.preset = preset.id;
      apply.textContent = current ? 'Wearing' : 'Wear';
      apply.disabled = current;
      actions.append(apply);
      if (!preset.builtin) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'delete';
        remove.dataset.action = 'delete';
        remove.dataset.preset = preset.id;
        remove.textContent = 'Delete';
        actions.append(remove);
      }

      card.append(top, meta, actions);
      grid.append(card);
    }

    const saveRow = document.createElement('div');
    saveRow.className = 'save-row';
    const input = document.createElement('input');
    input.id = 'look-name-input';
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'Name this look';
    input.value = draftName;
    input.setAttribute('aria-label', 'Name this look');
    const save = document.createElement('button');
    save.id = 'save-look';
    save.type = 'button';
    save.textContent = 'Save';
    save.disabled = !draftName.trim();
    saveRow.append(input, save);

    const wrap = document.createElement('div');
    wrap.append(grid, saveRow);
    return wrap;
  }

  function renderPanel() {
    panelEl.replaceChildren();
    if (activeTab === 'looks') {
      panelEl.append(renderLooks());
      return;
    }
    const tab = TABS.find((entry) => entry.id === activeTab);
    for (const slotId of tab.slots) panelEl.append(renderChips(slotId));
  }

  function renderHobbyChips() {
    hobbyEl.replaceChildren();
    const options = [{ id: null, label: 'Idle' }, ...BuffyHobbies.HOBBIES.map((hobby) => ({ id: hobby.id, label: hobby.label }))];
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-chip';
      button.textContent = option.label;
      button.dataset.hobby = option.id || '';
      button.setAttribute('aria-pressed', String(previewHobby === option.id));
      button.addEventListener('click', () => {
        previewHobby = option.id;
        previewStartedAt = performance.now();
        renderHobbyChips();
      });
      hobbyEl.append(button);
    }
  }

  function render() {
    renderTabs();
    renderPanel();
    updateLookName();
    renderHobbyChips();
  }

  async function update(patch) {
    const result = await api.update(patch);
    if (!result.ok) {
      setStatus(result.error || 'Could not save that change.', true);
      if (result.wardrobe) wardrobe = result.wardrobe;
      render();
      return;
    }
    wardrobe = result.wardrobe;
    setStatus('');
    render();
  }

  async function applyPreset(id) {
    const result = await api.applyPreset(id);
    if (!result.ok) {
      setStatus(result.error || 'Could not wear that look.', true);
      return;
    }
    wardrobe = result.wardrobe;
    setStatus('Look applied.');
    render();
  }

  async function deletePreset(id) {
    const result = await api.deletePreset(id);
    if (!result.ok) {
      setStatus(result.error || 'Could not delete that look.', true);
      return;
    }
    wardrobe = result.wardrobe;
    setStatus('Look deleted.');
    render();
  }

  async function saveLook() {
    const input = document.getElementById('look-name-input');
    const name = input ? input.value : draftName;
    const result = await api.savePreset(name);
    if (!result.ok) {
      setStatus(result.error || 'Could not save that look.', true);
      return;
    }
    wardrobe = result.wardrobe;
    draftName = '';
    setStatus(`Saved “${result.preset.name}”.`);
    render();
  }

  panelEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'apply') applyPreset(action.dataset.preset);
      else if (action.dataset.action === 'delete') deletePreset(action.dataset.preset);
      return;
    }
    if (target.closest('#save-look')) {
      saveLook();
      return;
    }
    const chip = target.closest('[data-slot]');
    if (chip) update({ [chip.dataset.slot]: chip.dataset.value });
  });

  panelEl.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'look-name-input') return;
    draftName = target.value;
    const save = document.getElementById('save-look');
    if (save) save.disabled = !draftName.trim();
  });

  tabsEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    activeTab = TABS[next].id;
    render();
    const button = tabsEl.querySelector(`[data-tab="${activeTab}"]`);
    if (button) button.focus();
  });

  surpriseEl.addEventListener('click', async () => {
    const result = await api.random();
    if (!result.ok) {
      setStatus(result.error || 'Could not pick a look.', true);
      return;
    }
    wardrobe = result.wardrobe;
    setStatus('A new look!');
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    previewCursor = {
      x: ((event.clientX - rect.left) / rect.width) * PREVIEW_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PREVIEW_HEIGHT,
    };
  });
  canvas.addEventListener('pointerleave', () => {
    previewCursor = null;
  });

  function resizePreview() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(PREVIEW_WIDTH * dpr);
    canvas.height = Math.round(PREVIEW_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startPreview() {
    resizePreview();
    const frame = (now) => {
      requestAnimationFrame(frame);
      if (!catalog || !wardrobe) return;
      ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      const meta = BuffyHobbies.HOBBIES.find((hobby) => hobby.id === previewHobby);
      let hobby = null;
      if (meta) {
        const elapsed = (now - previewStartedAt) % meta.durationMs;
        hobby = { id: meta.id, startedAt: now - elapsed, endsAt: now - elapsed + meta.durationMs };
      }
      BuffyCharacter.draw(ctx, {
        now,
        state: 'idle',
        look: wardrobe,
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        baseY: PREVIEW_BASE_Y,
        scale: 1.65,
        customImage: null,
        cursor: previewCursor,
        hobby,
      });
    };
    requestAnimationFrame(frame);
  }

  async function init() {
    if (!api) {
      setStatus('The wardrobe could not connect to Buffy.', true);
      return;
    }
    try {
      const data = await api.get();
      catalog = data.catalog;
      wardrobe = data.wardrobe;
      const preview = new URLSearchParams(window.location.search).get('preview');
      if (preview && BuffyHobbies.HOBBIES.some((hobby) => hobby.id === preview)) previewHobby = preview;
      render();
      startPreview();
      api.onChanged((next) => {
        wardrobe = next;
        render();
      });
    } catch (error) {
      setStatus(`Could not open the wardrobe. ${error.message}`, true);
    }
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') api.close();
  });

  init();
})();
