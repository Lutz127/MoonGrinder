import { DEMON_DIFFICULTIES, DIFFICULTIES, PLANNER_DIFFICULTY_MOON_GROUPS, RATINGS } from './constants.js';
import { difficultyFace, emptyState, moonReward, pillCheckbox, sectionHeading } from './components.js';
import { buildBlocks } from './planner.js';
import {
  downloadJson,
  escapeHtml,
  formatDuration,
  formatNumber,
  gdBrowserLevelUrl,
  gdBrowserUserUrl,
  parseWholeNumber,
} from './utils.js';

const BRIDGE_URL = 'http://127.0.0.1:17381';
const MAX_LIST_LEVELS = 100;

const LIST_DIFFICULTIES = [
  ['-1', 'N/A'],
  ['0', 'Auto'],
  ['1', 'Easy'],
  ['2', 'Normal'],
  ['3', 'Hard'],
  ['4', 'Harder'],
  ['5', 'Insane'],
  ['6', 'Easy Demon'],
  ['7', 'Medium Demon'],
  ['8', 'Hard Demon'],
  ['9', 'Insane Demon'],
  ['10', 'Extreme Demon'],
];

export function buildGdListPreset(catalog, state, kind, filters = {}, count = 100, options = {}) {
  const limit = Math.max(1, Math.min(MAX_LIST_LEVELS, Number(count) || MAX_LIST_LEVELS));
  let pool = catalog.available(state, { includeDeferred: filters.includeDeferred ?? true });
  pool = catalog.applyFilters(pool, filters, state);

  if (options.respectPlannerExclusions !== false) {
    const excluded = new Set(state.settings.plannerExcludedDifficulties || []);
    pool = pool.filter((level) => !excluded.has(level.difficulty));
  }

  if (kind === 'shortest' || kind === 'efficiency') {
    pool = pool.filter((level) => catalog.timeFor(level, state).seconds);
  }

  return catalog.sort(pool, kind === 'efficiency' ? 'efficiency' : 'duration', state).slice(0, limit);
}

function defaultFilters(app) {
  const inherited = app.viewState.plannerFilters || {};
  return {
    difficulties: [...(inherited.difficulties || [])],
    difficultyMoonGroups: [...(inherited.difficultyMoonGroups || [])],
    ratings: [...(inherited.ratings || [])],
    moons: [...(inherited.moons || [])],
    includeDeferred: inherited.includeDeferred ?? app.state.settings.includeDeferredInPlans,
    maxDurationSeconds: inherited.maxDurationSeconds || 0,
    respectPlannerExclusions: true,
  };
}

function listFilterMarkup(filters) {
  const wholeDifficultyPills = DIFFICULTIES
    .filter((difficulty) => difficulty !== 'N/A')
    .map((difficulty) => pillCheckbox('gd-list-difficulty-filter', difficulty, difficulty, filters.difficulties.includes(difficulty)))
    .join('');

  const splitPills = PLANNER_DIFFICULTY_MOON_GROUPS
    .map((group) => pillCheckbox(
      'gd-list-difficulty-moon-group',
      group.key,
      group.label,
      (filters.difficultyMoonGroups || []).includes(group.key),
    ))
    .join('');

  return `<div class="filter-grid gd-list-filter-grid">
    <div class="filter-group"><span class="filter-label">Difficulty</span><div class="filter-pills">${wholeDifficultyPills}</div></div>
    <div class="filter-group"><span class="filter-label">Hard / Harder / Insane reward splits</span><div class="filter-pills">${splitPills}</div></div>
    <div class="filter-group"><span class="filter-label">Rating</span><div class="filter-pills">${RATINGS.map((rating) => pillCheckbox('gd-list-rating-filter', rating, rating, filters.ratings.includes(rating))).join('')}</div></div>
    <div class="filter-group"><span class="filter-label">Moon reward</span><div class="filter-pills">${Array.from({ length: 10 }, (_, index) => index + 1).map((moons) => pillCheckbox('gd-list-moon-filter', moons, String(moons), filters.moons.includes(moons))).join('')}</div></div>
    <div class="filter-group filter-inline-options">
      <label class="check-row"><input id="gd-list-include-skipped" type="checkbox" ${filters.includeDeferred ? 'checked' : ''}><span>Include skipped levels</span></label>
      <label class="check-row"><input id="gd-list-respect-exclusions" type="checkbox" ${filters.respectPlannerExclusions ? 'checked' : ''}><span>Respect planner demon exclusions</span></label>
      <label class="field compact"><span>Maximum level time in minutes</span><input id="gd-list-max-duration" type="number" min="0" max="1440" value="${filters.maxDurationSeconds ? Math.round(filters.maxDurationSeconds / 60) : 0}"><small>Use 0 for no limit.</small></label>
    </div>
  </div>`;
}

function readFilters(root, previous) {
  const picked = (name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  return {
    difficulties: picked('gd-list-difficulty-filter'),
    difficultyMoonGroups: picked('gd-list-difficulty-moon-group'),
    ratings: picked('gd-list-rating-filter'),
    moons: picked('gd-list-moon-filter').map(Number),
    includeDeferred: root.querySelector('#gd-list-include-skipped')?.checked ?? previous.includeDeferred,
    maxDurationSeconds: parseWholeNumber(root.querySelector('#gd-list-max-duration')?.value, 0, 0, 1440) * 60,
    respectPlannerExclusions: root.querySelector('#gd-list-respect-exclusions')?.checked ?? true,
  };
}

function defaultDraft(app) {
  const staged = app.viewState.gdListDraft;
  if (staged?.levelIds?.length) {
    return {
      levelIds: [...staged.levelIds],
      source: staged.source || 'Planner',
      sourceTotal: staged.levelIds.length,
      suggestedName: staged.suggestedName || 'MoonGrinder List',
    };
  }

  const levels = buildGdListPreset(app.catalog, app.state, 'shortest', defaultFilters(app), 100, { respectPlannerExclusions: true });
  return {
    levelIds: levels.map((level) => String(level.level_id)),
    source: '100 shortest unfinished levels',
    sourceTotal: levels.length,
    suggestedName: 'Shortest Platformers',
  };
}

function uniqueValidIds(app, ids) {
  const seen = new Set();
  const result = [];
  for (const raw of ids || []) {
    const id = String(raw ?? '').trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function draftLevels(app) {
  return (app.viewState.gdListWorkingIds || []).map((id) => app.catalog.get(id) || {
    level_id: String(id),
    name: `Level ${id}`,
    creator: '',
    difficulty: 'N/A',
    rating: 'Rated',
    moons: 0,
    estimated_duration_seconds: null,
    outside_catalog: true,
  });
}

function sourceOptions(app) {
  const planCount = app.currentPlan?.levels?.length || 0;
  const blocks = app.currentBlocks?.length
    ? app.currentBlocks
    : buildBlocks(app.catalog, app.state, app.state.settings.blockMinutes || 60, 'shortest');
  if (!app.currentBlocks?.length) app.currentBlocks = blocks;

  return {
    planCount,
    blocks,
    html: `
      <option value="shortest">Shortest unfinished</option>
      <option value="efficiency">Most efficient unfinished</option>
      <option value="plan" ${planCount ? '' : 'disabled'}>Current planner result${planCount ? ` (${formatNumber(planCount)})` : ' (generate a plan first)'}</option>
      <option value="block" ${blocks.length ? '' : 'disabled'}>Grinding block</option>
      <option value="custom">Start empty</option>`,
  };
}

function listDifficultyOptions(selected = '3') {
  return LIST_DIFFICULTIES.map(([value, label]) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function visibilityOptions(selected = '2') {
  const options = [
    ['0', 'Public'],
    ['2', 'Unlisted'],
    ['1', 'Friends only'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${label}</option>`).join('');
}

function bridgeMarkup(bridge) {
  if (bridge?.connected) {
    return `<div class="gd-list-bridge-status connected"><span class="bridge-dot"></span><div><strong>Local uploader connected</strong><span>${bridge.username ? `Geometry Dash account: ${escapeHtml(bridge.username)}. ` : ''}Your GJP2 stays inside the local helper and is never sent to this page.</span></div></div>`;
  }
  if (bridge?.checking) {
    return `<div class="gd-list-bridge-status checking"><span class="bridge-dot"></span><div><strong>Checking local uploader</strong><span>Looking for the MoonGrinder helper on this computer.</span></div></div>`;
  }
  const detail = bridge?.error
    ? `<span>${escapeHtml(bridge.error)}</span>`
    : `<span>Run <code>tools\\gd_list_bridge.bat</code> on Windows or <code>tools/gd_list_bridge.sh</code> on macOS/Linux, then check again. The helper reads your local Geometry Dash save and performs the upload without exposing your login data to the website.</span>`;
  return `<div class="gd-list-bridge-status offline"><span class="bridge-dot"></span><div><strong>Local uploader is not connected</strong>${detail}</div></div>`;
}

function draftSummary(app, levels) {
  const timed = levels.map((level) => app.catalog.timeFor(level, app.state).seconds).filter(Boolean);
  const seconds = timed.reduce((sum, value) => sum + value, 0);
  const moons = levels.reduce((sum, level) => sum + (Number(level.moons) || 0), 0);
  const unknown = levels.filter((level) => level.outside_catalog).length;
  return `<div class="gd-list-draft-summary">
    <div><span>Levels</span><strong>${formatNumber(levels.length)} / ${MAX_LIST_LEVELS}</strong>${unknown ? `<small>${formatNumber(unknown)} outside catalog</small>` : ''}</div>
    <div><span>${unknown ? 'Known moon reward' : 'Total moons'}</span><strong>${formatNumber(moons)}</strong></div>
    <div><span>${unknown ? 'Known estimated time' : 'Estimated clear time'}</span><strong>${timed.length ? formatDuration(seconds, { compact: true }) : 'Unknown'}</strong></div>
  </div>`;
}

function draftRows(app, levels) {
  if (!levels.length) return emptyState('This list is empty.', 'Use a preset, search the catalog, or paste Level IDs below.');
  return `<div class="gd-list-levels">${levels.map((level, index) => `
    <article class="gd-list-level-row" draggable="true" data-draft-index="${index}">
      <span class="gd-list-drag" title="Drag to reorder">${String(index + 1).padStart(2, '0')}</span>
      ${difficultyFace(level, 'xs')}
      <div class="gd-list-level-name"><a href="${gdBrowserLevelUrl(level.level_id)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(level.name)}</strong></a><span>${level.outside_catalog ? 'Not in MoonGrinder catalog' : `by ${level.creator ? `<a href="${gdBrowserUserUrl(level.creator)}" target="_blank" rel="noopener noreferrer">${escapeHtml(level.creator)}</a>` : 'Unknown creator'}`} · ID ${escapeHtml(level.level_id)}</span></div>
      ${level.outside_catalog ? '<span class="gd-list-outside-badge">Custom ID</span>' : moonReward(level.moons)}
      <span class="gd-list-level-time">${formatDuration(app.catalog.timeFor(level, app.state).seconds, { compact: true })}</span>
      <div class="gd-list-row-actions"><button type="button" class="button button-ghost button-small" data-draft-move="up" data-draft-index="${index}" ${index === 0 ? 'disabled' : ''}>Up</button><button type="button" class="button button-ghost button-small" data-draft-move="down" data-draft-index="${index}" ${index === levels.length - 1 ? 'disabled' : ''}>Down</button><button type="button" class="button button-ghost button-small gd-list-remove" data-draft-remove="${index}">Remove</button></div>
    </article>`).join('')}</div>`;
}

function renderSearchResults(app, query) {
  const output = app.main.querySelector('#gd-list-search-results');
  if (!output) return;
  const text = String(query || '').trim().toLowerCase();
  if (!text) {
    output.innerHTML = '';
    return;
  }
  const existing = new Set(app.viewState.gdListWorkingIds || []);
  const matches = app.catalog.levels.filter((level) => {
    if (existing.has(String(level.level_id))) return false;
    return `${level.level_id} ${level.name} ${level.creator}`.toLowerCase().includes(text);
  }).slice(0, 8);
  output.innerHTML = matches.length ? matches.map((level) => `
    <button type="button" class="gd-list-search-result" data-add-level="${escapeHtml(level.level_id)}">
      ${difficultyFace(level, 'xs')}<span><strong>${escapeHtml(level.name)}</strong><small>${escapeHtml(level.creator || 'Unknown creator')} · ${escapeHtml(level.level_id)}</small></span>${moonReward(level.moons)}
    </button>`).join('') : '<div class="gd-list-search-empty">No matching level outside the current draft.</div>';
}

function renderDraftArea(app) {
  const levels = draftLevels(app);
  const summary = app.main.querySelector('#gd-list-draft-summary-root');
  const rows = app.main.querySelector('#gd-list-draft-rows');
  if (summary) summary.innerHTML = draftSummary(app, levels);
  if (rows) rows.innerHTML = draftRows(app, levels);
  const upload = app.main.querySelector('#gd-list-upload');
  if (upload) upload.disabled = !levels.length || levels.length > MAX_LIST_LEVELS;
  const count = app.main.querySelector('#gd-list-draft-count');
  if (count) count.textContent = `${levels.length} level${levels.length === 1 ? '' : 's'}`;
  wireDraftRowEvents(app);
}

function wireDraftRowEvents(app) {
  app.main.querySelectorAll('[data-draft-remove]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.draftRemove);
    app.viewState.gdListWorkingIds.splice(index, 1);
    renderDraftArea(app);
  }));

  app.main.querySelectorAll('[data-draft-move]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.draftIndex);
    const target = button.dataset.draftMove === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= app.viewState.gdListWorkingIds.length) return;
    const [id] = app.viewState.gdListWorkingIds.splice(index, 1);
    app.viewState.gdListWorkingIds.splice(target, 0, id);
    renderDraftArea(app);
  }));

  let dragIndex = null;
  app.main.querySelectorAll('.gd-list-level-row').forEach((row) => {
    row.addEventListener('dragstart', () => {
      dragIndex = Number(row.dataset.draftIndex);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      dragIndex = null;
      row.classList.remove('dragging');
    });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetIndex = Number(row.dataset.draftIndex);
      if (!Number.isInteger(dragIndex) || dragIndex === targetIndex) return;
      const [id] = app.viewState.gdListWorkingIds.splice(dragIndex, 1);
      app.viewState.gdListWorkingIds.splice(targetIndex, 0, id);
      renderDraftArea(app);
    });
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, targetAddressSpace: 'loopback', signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkBridge(app, notify = false) {
  const statusRoot = app.main.querySelector('#gd-list-bridge-root');
  app.viewState.gdListBridge = { ...(app.viewState.gdListBridge || {}), checking: true, connected: false };
  if (statusRoot) statusRoot.innerHTML = bridgeMarkup(app.viewState.gdListBridge);
  try {
    const response = await fetchWithTimeout(`${BRIDGE_URL}/status`, { method: 'GET', mode: 'cors' }, 2200);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.ok || !data?.token) throw new Error('Invalid helper response');
    app.viewState.gdListBridge = {
      connected: true,
      checking: false,
      token: data.token,
      username: data.username || '',
      platform: data.platform || '',
    };
    if (notify) app.toast('Local Geometry Dash uploader connected.');
  } catch (error) {
    let message = 'The helper is running, but the browser could not reach it.';
    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: 'loopback-network' });
        if (permission.state === 'denied') {
          message = "Browser access to this computer is blocked for MoonGrinder. Open this site's permissions and allow local/loopback network access, then try again.";
        } else if (permission.state === 'prompt') {
          message = 'MoonGrinder needs permission to connect to the local uploader on this computer. Click Check connection again and allow local network access if your browser asks.';
        }
      }
    } catch {
      // Older browsers may not expose the loopback-network permission name.
    }
    if (error?.name === 'AbortError') {
      message = 'The local uploader did not answer before the connection timed out. Make sure the helper window is still open.';
    }
    app.viewState.gdListBridge = { connected: false, checking: false, token: null, error: message };
    if (notify) app.toast(message, 'error');
  }
  if (statusRoot) statusRoot.innerHTML = bridgeMarkup(app.viewState.gdListBridge);
  const upload = app.main.querySelector('#gd-list-upload');
  if (upload) upload.textContent = app.viewState.gdListBridge.connected ? upload.dataset.connectedLabel || 'Upload to Geometry Dash' : 'Connect uploader to upload';
}

function currentMetadata(app) {
  return {
    listID: parseWholeNumber(app.main.querySelector('#gd-list-id')?.value, 0, 0, 999999999),
    listName: String(app.main.querySelector('#gd-list-name')?.value || '').trim(),
    listDesc: String(app.main.querySelector('#gd-list-description')?.value || '').trim(),
    difficulty: Number(app.main.querySelector('#gd-list-difficulty')?.value ?? -1),
    unlisted: Number(app.main.querySelector('#gd-list-visibility')?.value ?? 0),
    original: parseWholeNumber(app.main.querySelector('#gd-list-original')?.value, 0, 0, 999999999),
  };
}

function exportPayload(app) {
  const meta = currentMetadata(app);
  const levels = draftLevels(app);
  return {
    product: 'MoonGrinder GD List Draft',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: app.viewState.gdListSourceLabel || app.viewState.gdListDraft?.source || 'Custom',
    ...meta,
    levelIds: levels.map((level) => String(level.level_id)),
    levels: levels.map((level, index) => ({
      order: index + 1,
      level_id: String(level.level_id),
      name: level.name,
      creator: level.creator,
      difficulty: level.difficulty,
      moons: Number(level.moons) || 0,
      estimated_duration_seconds: app.catalog.timeFor(level, app.state).seconds,
    })),
  };
}

async function uploadList(app) {
  const levels = draftLevels(app);
  if (!levels.length) return app.toast('Add at least one level first.', 'error');
  if (levels.length > MAX_LIST_LEVELS) return app.toast('Geometry Dash lists can contain at most 100 levels.', 'error');

  if (!app.viewState.gdListBridge?.connected) {
    await checkBridge(app, false);
    if (!app.viewState.gdListBridge?.connected) {
      app.toast('Run the local uploader helper first.', 'error');
      return;
    }
  }

  const meta = currentMetadata(app);
  if (!meta.listName) return app.toast('Give the list a name first.', 'error');
  if (meta.listName.length > 24) return app.toast('Keep the list name at 24 characters or fewer.', 'error');
  if (meta.listDesc.length > 180) return app.toast('Keep the description at 180 characters or fewer.', 'error');

  const button = app.main.querySelector('#gd-list-upload');
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = meta.listID ? 'Updating list...' : 'Uploading list...';

  try {
    const response = await fetchWithTimeout(`${BRIDGE_URL}/upload`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'X-MoonGrinder-Token': app.viewState.gdListBridge.token,
      },
      body: JSON.stringify({
        ...meta,
        levelIds: levels.map((level) => String(level.level_id)),
      }),
    }, 35000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Upload failed with HTTP ${response.status}`);

    const id = Number(data.listID);
    if (id > 0) app.main.querySelector('#gd-list-id').value = String(id);
    app.viewState.gdListLastUpload = { id, at: new Date().toISOString() };
    const result = app.main.querySelector('#gd-list-upload-result');
    if (result) {
      result.innerHTML = `<div class="gd-list-upload-success"><strong>${meta.listID ? 'List updated' : 'List uploaded'}</strong><span>Geometry Dash List ID ${formatNumber(id)}</span><a href="https://gdbrowser.com/lists/${encodeURIComponent(String(id))}" target="_blank" rel="noopener noreferrer">Open list on GDBrowser</a></div>`;
    }
    app.toast(meta.listID ? 'Geometry Dash list updated.' : 'Geometry Dash list uploaded.');
  } catch (error) {
    app.toast(error?.message || 'Geometry Dash list upload failed.', 'error');
    const result = app.main.querySelector('#gd-list-upload-result');
    if (result) result.innerHTML = `<div class="gd-list-upload-error"><strong>Upload failed</strong><span>${escapeHtml(error?.message || String(error))}</span></div>`;
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

export function renderGdLists(app) {
  const { catalog, state } = app;
  const filters = app.viewState.gdListFilters || defaultFilters(app);
  app.viewState.gdListFilters = filters;

  if (!Array.isArray(app.viewState.gdListWorkingIds)) {
    const initial = defaultDraft(app);
    app.viewState.gdListWorkingIds = uniqueValidIds(app, initial.levelIds).slice(0, MAX_LIST_LEVELS);
    app.viewState.gdListSourceLabel = initial.source;
    app.viewState.gdListSourceTotal = initial.sourceTotal;
    app.viewState.gdListSuggestedName = initial.suggestedName;
    app.viewState.gdListDraft = null;
  }

  const sources = sourceOptions(app);
  const suggestedName = String(app.viewState.gdListSuggestedName || 'MoonGrinder List').slice(0, 24);
  const excluded = state.settings.plannerExcludedDifficulties || [];

  app.main.innerHTML = `
    <section class="page-intro gd-lists-intro">
      <div><span class="eyebrow">GD Lists</span><h1>Build a Geometry Dash list from your grind.</h1><p>Use a planner result, a grinding block, the shortest unfinished levels, the most efficient unfinished levels, or build a list manually.</p></div>
    </section>

    <section class="panel gd-list-bridge-panel">
      <div class="gd-list-bridge-copy">
        <div><span class="eyebrow">Account uploader</span><h2>Upload without putting your password in the website.</h2><p>MoonGrinder uses a tiny local helper because GitHub Pages cannot safely talk to the Geometry Dash servers directly. The helper reads GJP2 from your local CCGameManager.dat and never returns it to the browser.</p></div>
        <div class="button-row wrap"><button class="button button-secondary" type="button" id="gd-list-check-bridge">Check connection</button><a class="button button-ghost" href="https://github.com/Lutz127/MoonGrinder/blob/main/tools/GD_LIST_UPLOADER.md" target="_blank" rel="noopener noreferrer">Setup guide</a></div>
      </div>
      <div id="gd-list-bridge-root">${bridgeMarkup(app.viewState.gdListBridge)}</div>
    </section>

    <section class="gd-list-builder-grid">
      <article class="panel gd-list-source-panel">
        ${sectionHeading('Choose the levels', 'Presets only use unfinished levels. You can edit the exact order afterward.')}
        <div class="gd-list-source-controls">
          <label class="field"><span>Source</span><select id="gd-list-source">${sources.html}</select></label>
          <label class="field"><span>Number of levels</span><input id="gd-list-count" type="number" min="1" max="100" value="100"></label>
          <label class="field gd-list-block-field"><span>Grinding block</span><select id="gd-list-block-index">${sources.blocks.map((block, index) => `<option value="${index}">Block ${index + 1} · ${block.levels.length} levels · ${formatDuration(block.totalSeconds, { compact: true })}</option>`).join('') || '<option value="0">No blocks available</option>'}</select></label>
        </div>
        <button class="button button-primary" type="button" id="gd-list-build-source">Use this source</button>
        ${excluded.length ? `<p class="gd-list-exclusion-note">Planner exclusions currently hide ${excluded.map(escapeHtml).join(', ')} from automatic presets. You can turn that off in the filters below.</p>` : ''}
        <details class="filter-details gd-list-filters">
          <summary>Filters</summary>
          ${listFilterMarkup(filters)}
        </details>
      </article>

      <article class="panel gd-list-meta-panel">
        ${sectionHeading('List settings', 'These are the values sent to Geometry Dash when you upload.')}
        <div class="gd-list-meta-grid">
          <label class="field"><span>List name</span><input id="gd-list-name" maxlength="24" value="${escapeHtml(suggestedName)}" placeholder="MoonGrinder List"></label>
          <label class="field"><span>Difficulty face</span><select id="gd-list-difficulty">${listDifficultyOptions('3')}</select></label>
          <label class="field"><span>Visibility</span><select id="gd-list-visibility">${visibilityOptions('2')}</select></label>
          <label class="field"><span>Existing List ID</span><input id="gd-list-id" type="number" min="0" value="0"><small>Leave 0 to create a new list. Enter one of your uploaded List IDs to update its levels, description, visibility, or difficulty.</small></label>
          <label class="field gd-list-description-field"><span>Description</span><textarea id="gd-list-description" maxlength="180" rows="4" placeholder="Built with MoonGrinder"></textarea></label>
          <label class="field"><span>Original List ID</span><input id="gd-list-original" type="number" min="0" value="0"><small>Only use this when the list was copied from another uploaded list.</small></label>
        </div>
        <p class="gd-list-meta-note">New drafts default to Unlisted so you can verify the result first. Change Visibility to Public when you are ready. Geometry Dash may reject renaming an existing uploaded list, so keep its original name when updating one.</p>
      </article>
    </section>

    <section class="panel gd-list-draft-panel">
      <div class="gd-list-draft-heading">
        <div><span class="eyebrow">Draft</span><h2>${escapeHtml(app.viewState.gdListSourceLabel || 'Custom list')}</h2><p>Drag rows or use the Up and Down buttons to change the exact Geometry Dash order.</p></div>
        <div class="button-row wrap"><button class="button button-secondary button-small" type="button" id="gd-list-copy-ids">Copy IDs</button><button class="button button-secondary button-small" type="button" id="gd-list-export">Export JSON</button><label class="button button-secondary button-small file-button">Import JSON<input id="gd-list-import" type="file" accept="application/json,.json"></label><button class="button button-ghost button-small" type="button" id="gd-list-clear">Clear</button></div>
      </div>
      <div id="gd-list-draft-summary-root">${draftSummary(app, draftLevels(app))}</div>

      <div class="gd-list-add-search">
        <label class="search-field"><span class="sr-only">Search the MoonGrinder catalog</span><input id="gd-list-search" type="search" placeholder="Search catalog by name, creator, or Level ID"></label>
        <span id="gd-list-draft-count">${draftLevels(app).length} levels</span>
      </div>
      <div id="gd-list-search-results" class="gd-list-search-results"></div>
      <div class="gd-list-manual-add">
        <label class="field"><span>Add any Geometry Dash Level ID</span><input id="gd-list-manual-ids" type="text" inputmode="numeric" placeholder="Paste one or more IDs separated by spaces or commas"><small>IDs outside MoonGrinder's rated-platformer catalog can still be uploaded to a GD List.</small></label>
        <button class="button button-secondary" type="button" id="gd-list-add-ids">Add IDs</button>
      </div>
      <div id="gd-list-draft-rows">${draftRows(app, draftLevels(app))}</div>

      <div class="gd-list-upload-footer">
        <div><strong>Ready to put this list in Geometry Dash?</strong><span>Maximum 100 levels. Your login data stays in the local helper.</span></div>
        <button class="button button-primary button-large" type="button" id="gd-list-upload" data-connected-label="Upload to Geometry Dash">${app.viewState.gdListBridge?.connected ? 'Upload to Geometry Dash' : 'Connect uploader to upload'}</button>
      </div>
      <div id="gd-list-upload-result"></div>
    </section>
  `;

  const updateBlockVisibility = () => {
    const isBlock = app.main.querySelector('#gd-list-source').value === 'block';
    app.main.querySelector('.gd-list-block-field').classList.toggle('is-hidden', !isBlock);
    const count = app.main.querySelector('#gd-list-count');
    count.disabled = ['plan', 'block', 'custom'].includes(app.main.querySelector('#gd-list-source').value);
  };

  const buildSource = () => {
    const kind = app.main.querySelector('#gd-list-source').value;
    const nextFilters = readFilters(app.main.querySelector('.gd-list-filters'), filters);
    app.viewState.gdListFilters = nextFilters;
    const count = parseWholeNumber(app.main.querySelector('#gd-list-count').value, 100, 1, 100);
    let levels = [];
    let sourceLabel = 'Custom list';
    let total = 0;

    if (kind === 'plan') {
      levels = app.currentPlan?.levels || [];
      total = levels.length;
      sourceLabel = 'Current planner result';
    } else if (kind === 'block') {
      const index = parseWholeNumber(app.main.querySelector('#gd-list-block-index').value, 0, 0, Math.max(0, sources.blocks.length - 1));
      levels = sources.blocks[index]?.levels || [];
      total = levels.length;
      sourceLabel = `Grinding block ${index + 1}`;
    } else if (kind === 'custom') {
      levels = [];
      total = 0;
      sourceLabel = 'Custom list';
    } else {
      levels = buildGdListPreset(catalog, state, kind, nextFilters, count, { respectPlannerExclusions: nextFilters.respectPlannerExclusions });
      total = levels.length;
      sourceLabel = kind === 'efficiency' ? `${levels.length} most efficient unfinished levels` : `${levels.length} shortest unfinished levels`;
    }

    const ids = uniqueValidIds(app, levels.map((level) => level.level_id));
    app.viewState.gdListWorkingIds = ids.slice(0, MAX_LIST_LEVELS);
    app.viewState.gdListSourceLabel = sourceLabel;
    app.viewState.gdListSourceTotal = total;
    const heading = app.main.querySelector('.gd-list-draft-heading h2');
    if (heading) heading.textContent = sourceLabel;
    renderDraftArea(app);
    if (total > MAX_LIST_LEVELS) app.toast(`Geometry Dash allows 100 levels per list. The first 100 of ${total} were loaded.`);
    else app.toast(`Loaded ${ids.length} level${ids.length === 1 ? '' : 's'} into the draft.`);
  };

  app.main.querySelector('#gd-list-source').addEventListener('change', updateBlockVisibility);
  app.main.querySelector('#gd-list-build-source').addEventListener('click', buildSource);
  updateBlockVisibility();

  app.main.querySelector('#gd-list-check-bridge').addEventListener('click', () => checkBridge(app, true));
  app.main.querySelector('#gd-list-upload').addEventListener('click', () => uploadList(app));

  app.main.querySelector('#gd-list-search').addEventListener('input', (event) => renderSearchResults(app, event.target.value));
  app.main.querySelector('#gd-list-search-results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-level]');
    if (!button) return;
    if (app.viewState.gdListWorkingIds.length >= MAX_LIST_LEVELS) return app.toast('This draft already has 100 levels.', 'error');
    const id = String(button.dataset.addLevel);
    if (app.viewState.gdListWorkingIds.includes(id)) return;
    app.viewState.gdListWorkingIds.push(id);
    renderDraftArea(app);
    app.main.querySelector('#gd-list-search').value = '';
    renderSearchResults(app, '');
  });

  app.main.querySelector('#gd-list-add-ids').addEventListener('click', () => {
    const input = app.main.querySelector('#gd-list-manual-ids');
    const tokens = String(input.value || '').split(/[^0-9]+/).filter(Boolean);
    const incoming = uniqueValidIds(app, tokens);
    if (!incoming.length) return app.toast('Paste at least one valid numeric Level ID.', 'error');
    const existing = new Set(app.viewState.gdListWorkingIds);
    const availableSlots = MAX_LIST_LEVELS - app.viewState.gdListWorkingIds.length;
    const additions = incoming.filter((id) => !existing.has(id)).slice(0, Math.max(0, availableSlots));
    if (!additions.length) return app.toast(availableSlots <= 0 ? 'This draft already has 100 levels.' : 'Those Level IDs are already in the draft.', 'error');
    app.viewState.gdListWorkingIds.push(...additions);
    input.value = '';
    renderDraftArea(app);
    if (additions.length < incoming.filter((id) => !existing.has(id)).length) app.toast(`Added ${additions.length} IDs. The list reached the 100-level limit.`);
    else app.toast(`Added ${additions.length} Level ID${additions.length === 1 ? '' : 's'}.`);
  });

  app.main.querySelector('#gd-list-copy-ids').addEventListener('click', () => app.copy(app.viewState.gdListWorkingIds.join(','), 'List IDs copied.'));
  app.main.querySelector('#gd-list-export').addEventListener('click', () => {
    downloadJson(`moongrinder-gd-list-${new Date().toISOString().slice(0, 10)}.json`, exportPayload(app));
    app.toast('List draft exported.');
  });
  app.main.querySelector('#gd-list-import').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ids = uniqueValidIds(app, data.levelIds || data.levels?.map((row) => row.level_id));
      if (!ids.length) throw new Error('This file does not contain any valid Level IDs.');
      app.viewState.gdListWorkingIds = ids.slice(0, MAX_LIST_LEVELS);
      app.viewState.gdListSourceLabel = data.source || 'Imported draft';
      if (data.listName) app.main.querySelector('#gd-list-name').value = String(data.listName).slice(0, 24);
      if (data.listDesc != null) app.main.querySelector('#gd-list-description').value = String(data.listDesc).slice(0, 180);
      if (data.difficulty != null) app.main.querySelector('#gd-list-difficulty').value = String(data.difficulty);
      if (data.unlisted != null) app.main.querySelector('#gd-list-visibility').value = String(data.unlisted);
      if (data.listID != null) app.main.querySelector('#gd-list-id').value = String(data.listID);
      if (data.original != null) app.main.querySelector('#gd-list-original').value = String(data.original);
      app.main.querySelector('.gd-list-draft-heading h2').textContent = app.viewState.gdListSourceLabel;
      renderDraftArea(app);
      app.toast(`Imported ${app.viewState.gdListWorkingIds.length} levels.`);
    } catch (error) {
      app.toast(error?.message || 'Could not import this list draft.', 'error');
    } finally {
      event.target.value = '';
    }
  });
  app.main.querySelector('#gd-list-clear').addEventListener('click', () => {
    app.viewState.gdListWorkingIds = [];
    app.viewState.gdListSourceLabel = 'Custom list';
    app.main.querySelector('.gd-list-draft-heading h2').textContent = 'Custom list';
    renderDraftArea(app);
  });

  wireDraftRowEvents(app);
  checkBridge(app, false);
}
