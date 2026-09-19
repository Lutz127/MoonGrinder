import { ROUTES } from './constants.js';
import { loadCatalog } from './catalog.js';
import { renderRoute } from './views.js';
import { clearState, loadState, saveState, validateImportedState } from './storage.js';
import { copyText, difficultyAsset, downloadJson, escapeHtml, formatDuration, formatNumber, parseTimeInput, uuid } from './utils.js';
import { moonReward, ratingBadge, statusBadge } from './components.js';
import { readGeometryDashSave } from './gd-save.js';

class MoonGrinderWeb {
  constructor() {
    this.catalog = null;
    this.state = loadState();
    this.viewState = {};
    this.currentPlan = null;
    this.currentBlocks = [];
    this.main = document.querySelector('#main-content');
    this.modalRoot = document.querySelector('#modal-root');
    this.toastRoot = document.querySelector('#toast-root');
    this.sidebar = document.querySelector('#sidebar');
    this.route = 'overview';
    this.timerHandle = null;
  }

  async init() {
    this.renderLoading();
    try {
      this.catalog = await loadCatalog();
      this.bindGlobalEvents();
      this.route = this.routeFromHash();
      this.renderNav();
      this.render();
      this.startTimerTick();
    } catch (error) {
      console.error(error);
      this.renderFatal(error);
    }
  }

  routeFromHash() {
    const value = location.hash.replace(/^#\/?/, '').split('?')[0];
    return ROUTES.some(([route]) => route === value) ? value : 'overview';
  }

  bindGlobalEvents() {
    window.addEventListener('hashchange', () => {
      this.route = this.routeFromHash();
      this.renderNav();
      this.render();
      window.scrollTo({ top: 0, behavior: 'auto' });
    });

    document.addEventListener('click', (event) => {
      const routeButton = event.target.closest('[data-route]');
      if (routeButton) {
        event.preventDefault();
        this.navigate(routeButton.dataset.route);
        return;
      }

      const action = event.target.closest('[data-action]');
      if (!action) return;
      const id = action.dataset.levelId;
      switch (action.dataset.action) {
        case 'level-detail':
          this.showLevelDetail(id);
          break;
        case 'toggle-completed':
          this.toggleCompleted(id);
          break;
        default:
          break;
      }
    });

    document.querySelector('#mobile-menu-button').addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });

    document.querySelector('#sidebar-scrim').addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.modalRoot.children.length) {
        this.closeModal();
        return;
      }
      if (this.route !== 'grind' || !this.state.activeSession) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if (key === 'c') this.completeCurrent();
      else if (key === 's') this.skipCurrent();
      else if (key === 'u') this.undoCompletion();
      else if (key === 'p') this.togglePause();
      else if (key === 'i') {
        const level = this.currentSessionLevel();
        if (level) this.copy(level.level_id, 'Level ID copied.');
      }
    });
  }

  renderNav() {
    const active = this.route;
    document.querySelector('#nav-list').innerHTML = ROUTES.map(([route, label]) => {
      const hasSession = route === 'grind' && this.state.activeSession;
      return `<a href="#/${route}" class="nav-link ${active === route ? 'active' : ''}"><span>${escapeHtml(label)}</span>${hasSession ? '<i class="nav-live-dot" aria-label="Active session"></i>' : ''}</a>`;
    }).join('');
    document.querySelector('#mobile-title').textContent = ROUTES.find(([route]) => route === active)?.[1] || 'MoonGrinder';
    document.body.classList.remove('sidebar-open');
  }

  render() {
    if (!this.catalog) return;
    renderRoute(this, this.route);
    this.renderNav();
  }

  renderLoading() {
    this.main.innerHTML = `<section class="loading-state"><img src="./assets/images/moon.png" alt=""><div><h1>Loading MoonGrinder</h1><p>Reading the public platformer catalog.</p></div></section>`;
  }

  renderFatal(error) {
    this.main.innerHTML = `<section class="fatal-state"><h1>MoonGrinder could not load the catalog.</h1><p>${escapeHtml(error?.message || String(error))}</p><p>If you opened index.html directly from disk, use a local web server instead. GitHub Pages will serve the site correctly.</p></section>`;
  }

  navigate(route) {
    if (this.route === route) {
      this.render();
      return;
    }
    location.hash = `#/${route}`;
  }

  save() {
    saveState(this.state);
  }

  toast(message, tone = 'default') {
    const item = document.createElement('div');
    item.className = `toast toast-${tone}`;
    item.textContent = message;
    this.toastRoot.append(item);
    requestAnimationFrame(() => item.classList.add('visible'));
    setTimeout(() => {
      item.classList.remove('visible');
      setTimeout(() => item.remove(), 250);
    }, 2600);
  }

  async copy(text, successMessage = 'Copied.') {
    const ok = await copyText(text);
    this.toast(ok ? successMessage : 'Copy failed.', ok ? 'default' : 'error');
  }

  showLevelDetail(id) {
    const level = this.catalog.get(id);
    if (!level) return;
    const status = this.catalog.status(id, this.state);
    const effective = this.catalog.timeFor(level, this.state);
    const efficiency = this.catalog.efficiency(level, this.state);
    const override = this.state.progress.overrides[String(id)] || '';

    this.modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-close="true">
      <article class="modal level-modal" role="dialog" aria-modal="true" aria-labelledby="level-modal-title">
        <button class="modal-close" type="button" data-modal-close="true" aria-label="Close">Close</button>
        <header class="level-modal-header">
          <img class="difficulty-face difficulty-face-xl" src="${difficultyAsset(level.difficulty, level.rating)}" alt="${escapeHtml(level.rating || 'Rated')} ${escapeHtml(level.difficulty)} difficulty icon" onerror="this.onerror=null;this.src='${difficultyBaseAsset(level.difficulty)}'">
          <div><span class="eyebrow">${escapeHtml(level.difficulty)}</span><h2 id="level-modal-title">${escapeHtml(level.name)}</h2><p>by ${escapeHtml(level.creator || 'Unknown creator')} · ID ${escapeHtml(level.level_id)}</p><div class="modal-badges">${ratingBadge(level.rating)}${statusBadge(status)}${moonReward(level.moons, 'large')}</div></div>
        </header>
        <div class="modal-metric-grid modal-metric-grid-two">
          <div><span>Estimated time</span><strong>${formatDuration(effective.seconds)}</strong><small>${effective.custom ? 'Using your custom time' : 'Used for planning'}</small></div>
          <div><span>Efficiency</span><strong>${efficiency ? `${formatNumber(efficiency, 2)}/min` : 'Unknown'}</strong><small>Moons per minute</small></div>
        </div>
        <section class="modal-section">
          <h3>Your level state</h3>
          <div class="button-row wrap">
            <button class="button ${status === 'completed' ? 'button-primary' : 'button-secondary'}" id="modal-complete">${status === 'completed' ? 'Mark unfinished' : 'Mark completed'}</button>
            <button class="button ${status === 'deferred' ? 'button-primary' : 'button-secondary'}" id="modal-defer">${status === 'deferred' ? 'Unskip' : 'Skip'}</button>
            <button class="button ${status === 'excluded' ? 'button-danger' : 'button-secondary'}" id="modal-exclude">${status === 'excluded' ? 'Remove exclusion' : 'Exclude from planners'}</button>
          </div>
        </section>
        <section class="modal-section">
          <h3>Custom time</h3>
          <p>Use seconds, m:ss, or h:mm:ss. Leave it blank to use the normal estimate.</p>
          <div class="override-row"><input id="override-time" type="text" value="${escapeHtml(override)}" placeholder="Example: 2:35"><button class="button button-primary" id="save-override">Save override</button><button class="button button-ghost" id="clear-override">Clear</button></div>
        </section>
        <footer class="modal-footer"><button class="button button-secondary" id="copy-level-name">Copy name</button><button class="button button-secondary" id="copy-level-id">Copy Level ID</button></footer>
      </article>
    </div>`;

    const backdrop = this.modalRoot.querySelector('.modal-backdrop');
    backdrop.addEventListener('click', (event) => {
      if (event.target.dataset.modalClose === 'true') this.closeModal();
    });
    this.modalRoot.querySelector('#modal-complete').addEventListener('click', () => {
      this.toggleCompleted(id, false);
      this.showLevelDetail(id);
    });
    this.modalRoot.querySelector('#modal-defer').addEventListener('click', () => {
      this.toggleDeferred(id, false);
      this.showLevelDetail(id);
    });
    this.modalRoot.querySelector('#modal-exclude').addEventListener('click', () => {
      this.toggleExcluded(id, false);
      this.showLevelDetail(id);
    });
    this.modalRoot.querySelector('#save-override').addEventListener('click', () => {
      const seconds = parseTimeInput(this.modalRoot.querySelector('#override-time').value);
      if (!seconds || seconds <= 0) {
        this.toast('Enter a valid positive time.', 'error');
        return;
      }
      this.state.progress.overrides[String(id)] = Math.round(seconds);
      this.save();
      this.toast('Custom time saved.');
      this.showLevelDetail(id);
    });
    this.modalRoot.querySelector('#clear-override').addEventListener('click', () => {
      delete this.state.progress.overrides[String(id)];
      this.save();
      this.toast('Custom time cleared.');
      this.showLevelDetail(id);
    });
    this.modalRoot.querySelector('#copy-level-name').addEventListener('click', () => this.copy(level.name, 'Level name copied.'));
    this.modalRoot.querySelector('#copy-level-id').addEventListener('click', () => this.copy(level.level_id, 'Level ID copied.'));
  }

  closeModal() {
    this.modalRoot.innerHTML = '';
  }

  toggleCompleted(id, rerender = true) {
    const key = String(id);
    if (this.state.progress.completed[key]) {
      delete this.state.progress.completed[key];
      this.state.progress.lastCompletionStack = this.state.progress.lastCompletionStack.filter((item) => item !== key);
      this.toast('Level marked unfinished.');
    } else {
      this.state.progress.completed[key] = { at: new Date().toISOString(), actualSeconds: 0, sessionId: '' };
      this.state.progress.lastCompletionStack.push(key);
      this.state.progress.deferred = this.state.progress.deferred.filter((item) => item !== key);
      this.state.progress.excluded = this.state.progress.excluded.filter((item) => item !== key);
      this.toast('Level marked completed.');
    }
    this.save();
    if (rerender) this.render();
  }

  toggleDeferred(id, rerender = true) {
    const key = String(id);
    const index = this.state.progress.deferred.indexOf(key);
    if (index >= 0) {
      this.state.progress.deferred.splice(index, 1);
      this.toast('Level removed from skipped list.');
    } else {
      this.state.progress.deferred.push(key);
      this.state.progress.excluded = this.state.progress.excluded.filter((item) => item !== key);
      this.toast('Level skipped.');
    }
    this.save();
    if (rerender) this.render();
  }

  toggleExcluded(id, rerender = true) {
    const key = String(id);
    const index = this.state.progress.excluded.indexOf(key);
    if (index >= 0) {
      this.state.progress.excluded.splice(index, 1);
      this.toast('Level returned to planners.');
    } else {
      this.state.progress.excluded.push(key);
      this.state.progress.deferred = this.state.progress.deferred.filter((item) => item !== key);
      this.toast('Level excluded from planners.');
    }
    this.save();
    if (rerender) this.render();
  }

  startSession(levels, name = 'Grinding Session') {
    const levelIds = levels
      .map((level) => String(level.level_id))
      .filter((id) => !this.state.progress.completed[id] && !this.state.progress.excluded.includes(id));
    if (!levelIds.length) {
      this.toast('There are no unfinished levels in this plan.', 'error');
      return;
    }
    if (this.state.activeSession && !confirm('Replace the current active session with this new plan?')) return;
    this.state.activeSession = {
      id: uuid(),
      name,
      startedAt: new Date().toISOString(),
      endedAt: null,
      levelIds,
      index: 0,
      log: [],
      timer: {
        accumulatedSeconds: 0,
        runningStartedAt: Date.now(),
        paused: false,
      },
    };
    this.save();
    this.navigate('grind');
    this.toast(`Started ${name}.`);
  }

  currentSessionLevel() {
    const session = this.state.activeSession;
    if (!session) return null;
    return this.catalog.get(session.levelIds[session.index]);
  }

  sessionElapsed() {
    const timer = this.state.activeSession?.timer;
    if (!timer) return 0;
    const accumulated = Number(timer.accumulatedSeconds) || 0;
    if (timer.paused || !timer.runningStartedAt) return accumulated;
    return accumulated + Math.max(0, (Date.now() - Number(timer.runningStartedAt)) / 1000);
  }

  resetSessionTimer() {
    if (!this.state.activeSession) return;
    this.state.activeSession.timer = {
      accumulatedSeconds: 0,
      runningStartedAt: Date.now(),
      paused: false,
    };
  }

  completeCurrent() {
    const session = this.state.activeSession;
    const level = this.currentSessionLevel();
    if (!session || !level) return;
    const actualSeconds = Math.max(0, Math.round(this.sessionElapsed()));
    const id = String(level.level_id);
    const now = new Date().toISOString();
    this.state.progress.completed[id] = { at: now, actualSeconds, sessionId: session.id };
    this.state.progress.lastCompletionStack.push(id);
    this.state.progress.deferred = this.state.progress.deferred.filter((item) => item !== id);
    this.state.progress.excluded = this.state.progress.excluded.filter((item) => item !== id);
    session.log.push({ levelId: id, result: 'completed', actualSeconds, at: now });
    session.index += 1;
    this.resetSessionTimer();
    this.save();
    if (session.index >= session.levelIds.length) this.finishSession();
    else this.render();
  }

  skipCurrent() {
    const session = this.state.activeSession;
    const level = this.currentSessionLevel();
    if (!session || !level) return;
    const id = String(level.level_id);
    session.log.push({ levelId: id, result: 'skipped', actualSeconds: Math.round(this.sessionElapsed()), at: new Date().toISOString() });
    session.levelIds.push(session.levelIds.splice(session.index, 1)[0]);
    this.resetSessionTimer();
    this.save();
    this.render();
    this.toast('Level moved to the end of the queue.');
  }

  undoCompletion() {
    const stack = this.state.progress.lastCompletionStack;
    if (!stack.length) {
      this.toast('There is no completion to undo.', 'error');
      return;
    }
    const id = stack.pop();
    delete this.state.progress.completed[id];
    const session = this.state.activeSession;
    if (session) {
      session.levelIds.splice(session.index, 0, id);
      for (let i = session.log.length - 1; i >= 0; i -= 1) {
        if (session.log[i].levelId === id && session.log[i].result === 'completed') {
          session.log.splice(i, 1);
          break;
        }
      }
      this.resetSessionTimer();
    }
    this.save();
    this.render();
    this.toast('Last completion undone.');
  }

  togglePause() {
    const timer = this.state.activeSession?.timer;
    if (!timer) return;
    if (timer.paused) {
      timer.paused = false;
      timer.runningStartedAt = Date.now();
    } else {
      timer.accumulatedSeconds = this.sessionElapsed();
      timer.runningStartedAt = null;
      timer.paused = true;
    }
    this.save();
    this.render();
  }

  finishSession() {
    const session = this.state.activeSession;
    if (!session) return;
    session.endedAt = new Date().toISOString();
    this.state.sessions.push({ ...session, timer: undefined });
    this.state.sessions = this.state.sessions.slice(-100);
    this.state.activeSession = null;
    this.save();
    this.navigate('overview');
    this.toast('Grinding session finished.');
  }

  startTimerTick() {
    clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (this.route !== 'grind' || !this.state.activeSession) return;
      const timer = document.querySelector('#live-session-timer');
      if (timer) timer.textContent = formatDuration(this.sessionElapsed());
    }, 250);
  }

  exportSave() {
    const payload = {
      product: 'MoonGrinder Web',
      exportedAt: new Date().toISOString(),
      state: this.state,
    };
    downloadJson(`moongrinder-save-${new Date().toISOString().slice(0, 10)}.json`, payload);
    this.toast('Save exported.');
  }

  async importSave(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const candidate = parsed.state || parsed;
      const next = validateImportedState(candidate);
      if (!confirm('Replace the current local MoonGrinder progress with this imported save?')) return;
      this.state = next;
      this.save();
      this.render();
      this.toast('Save imported.');
    } catch (error) {
      this.toast(error?.message || 'Could not import this save.', 'error');
    }
  }

  async importGeometryDashSave(file) {
    if (!file) return;

    try {
      this.toast('Reading Geometry Dash save...');
      const gd = await readGeometryDashSave(file);
      const saveIds = new Set(gd.completedOnlineIds.map(String));
      const matchedLevels = this.catalog.levels.filter((level) => saveIds.has(String(level.level_id)));
      const matchedIds = matchedLevels.map((level) => String(level.level_id));
      const matchedMoons = matchedLevels.reduce((sum, level) => sum + (Number(level.moons) || 0), 0);
      const baseline = Number.isFinite(gd.moonCount) ? Number(gd.moonCount) - matchedMoons : null;

      this.viewState.gdImportPreview = {
        fileName: String(file.name || 'CCGameManager.dat'),
        completedOnlineIds: gd.completedOnlineIds.length,
        completedOnlineIdsList: gd.completedOnlineIds,
        completedByPrefix: gd.completedByPrefix || { 'c_': gd.completedOnlineIds },
        matchedCatalogLevels: matchedLevels.length,
        matchedCatalogMoons: matchedMoons,
        matchedIds,
        moonCount: gd.moonCount,
        baseline: Number.isFinite(baseline) && baseline >= 0 ? baseline : null,
      };

      this.render();
      this.toast('Geometry Dash save loaded. Review the summary and sync when ready.');
    } catch (error) {
      console.error(error);
      this.viewState.gdImportPreview = null;
      this.toast(error?.message || 'Could not read this Geometry Dash save.', 'error');
    }
  }

  syncGeometryDashSave() {
    const preview = this.viewState.gdImportPreview;
    if (!preview) return;

    const matchedIds = new Set((preview.matchedIds || []).map(String));
    const importedAt = new Date().toISOString();
    const previous = this.state.progress.completed || {};
    const nextCompleted = {};

    for (const id of matchedIds) {
      const existing = previous[id];
      nextCompleted[id] = existing && typeof existing === 'object'
        ? existing
        : { at: importedAt, actualSeconds: 0, sessionId: '' };
    }

    this.state.progress.completed = nextCompleted;
    this.state.progress.lastCompletionStack = this.state.progress.lastCompletionStack
      .filter((id) => matchedIds.has(String(id)));

    const stacked = new Set(this.state.progress.lastCompletionStack.map(String));
    for (const id of matchedIds) {
      if (!stacked.has(id)) this.state.progress.lastCompletionStack.push(id);
    }

    this.state.progress.deferred = this.state.progress.deferred.filter((id) => !matchedIds.has(String(id)));
    this.state.progress.excluded = this.state.progress.excluded.filter((id) => !matchedIds.has(String(id)));

    let baselineUpdated = false;
    if (Number.isFinite(preview.moonCount) && Number.isFinite(preview.baseline) && preview.baseline >= 0) {
      // startingMoons is an internal baseline. Catalog completion moons are added
      // on top of it, so currentMoons still equals the actual in-game total.
      this.state.settings.startingMoons = preview.baseline;
      baselineUpdated = true;
    }

    this.state.progress.gdImport = {
      importedAt,
      fileName: preview.fileName,
      completedOnlineIds: preview.completedOnlineIds,
      completedOnlineIdsList: preview.completedOnlineIdsList || [],
      completedByPrefix: preview.completedByPrefix || { 'c_': preview.completedOnlineIdsList || [] },
      matchedCatalogLevels: preview.matchedCatalogLevels,
      matchedCatalogMoons: preview.matchedCatalogMoons,
      moonCount: preview.moonCount,
      baselineUpdated,
    };

    this.viewState.gdImportPreview = null;
    this.save();
    this.render();

    const result = preview.moonCount == null
      ? `Synced ${formatNumber(preview.matchedCatalogLevels)} completed rated platformers.`
      : `Synced ${formatNumber(preview.matchedCatalogLevels)} rated platformers. Current moons: ${formatNumber(preview.moonCount)}.`;
    this.toast(result);
  }

  clearGeometryDashImportPreview() {
    this.viewState.gdImportPreview = null;
    this.render();
  }

  resetLocalData() {
    if (!confirm('Reset all MoonGrinder progress, sessions, overrides, and settings stored in this browser?')) return;
    if (!confirm('This cannot be undone unless you exported a save. Continue?')) return;
    clearState();
    this.state = loadState();
    this.viewState = {};
    this.closeModal();
    this.render();
    this.toast('Local MoonGrinder data reset.');
  }
}

const app = new MoonGrinderWeb();
app.init();
