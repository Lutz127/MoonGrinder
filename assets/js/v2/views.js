import { DEMON_DIFFICULTIES, DIFFICULTIES, PLANNER_DIFFICULTY_MOON_GROUPS, RATINGS, STRATEGIES } from './constants.js';
import {
  difficultyFace,
  emptyState,
  levelCard,
  levelRow,
  moonReward,
  pillCheckbox,
  planHeader,
  planLevelList,
  progressBar,
  ratingBadge,
  sectionHeading,
  statCard,
  statusBadge,
} from './components.js';
import { buildBlocks, buildMoonGoalPlan, buildTimeBudgetPlan } from './planner.js';
import { debounce, escapeHtml, formatDate, formatDuration, formatNumber, parseWholeNumber } from './utils.js';
import { MOON_AUDIT_LEVELS, MOON_AUDIT_SECTION_LABELS, MOON_AUDIT_SOURCE_NAME } from './moon-audit-data.js';
import { renderMoonCheck } from './moon-check.js';

export function renderRoute(app, route) {
  switch (route) {
    case 'planner': return renderPlanner(app);
    case 'catalog': return renderCatalog(app);
    case 'grind': return renderGrind(app);
    case 'progress': return renderProgress(app);
    case 'moon-check': return renderMoonCheck(app);
    case 'stats': return renderStats(app);
    case 'settings': return renderSettings(app);
    case 'about': return renderAbout(app);
    case 'overview':
    default: return renderOverview(app);
  }
}

function renderOverview(app) {
  const { catalog, state } = app;
  const summary = catalog.progressSummary(state);
  const target = Math.max(summary.currentMoons, Number(state.settings.targetMoons) || 0);
  const toTarget = Math.max(0, target - summary.currentMoons);
  const available = catalog.available(state, { includeDeferred: state.settings.includeDeferredInPlans });
  const timed = available.filter((level) => catalog.timeFor(level, state).seconds);
  const remainingSeconds = timed.reduce((sum, level) => sum + catalog.timeFor(level, state).seconds, 0);
  const remainingMoons = available.reduce((sum, level) => sum + Number(level.moons || 0), 0);
  const rate = remainingSeconds ? remainingMoons * 60 / remainingSeconds : 0;
  const blocks = buildBlocks(catalog, state, state.settings.blockMinutes, 'shortest');
  app.currentBlocks = blocks;

  const best = catalog.sort(timed, 'efficiency', state).slice(0, 6);
  const catalogStats = catalog.data.stats || {};

  app.main.innerHTML = `
    <section class="hero hero-overview">
      <div class="hero-copy">
        <h1>MoonGrinder</h1>
        <p>Find the best levels to moongrind as fast as possible.</p>
        <div class="hero-actions">
          <button class="button button-primary" data-route="planner">Start grinding</button>
          <button class="button button-secondary" data-route="catalog">Browse levels</button>
        </div>
      </div>
      <div class="hero-moon-panel">
        <img src="./assets/images/moon.png" alt="Moon">
        <div><span>Current moon count</span><strong>${formatNumber(summary.currentMoons)}</strong><small>${formatNumber(toTarget)} to target</small></div>
      </div>
    </section>

    <section class="stat-grid four">
      ${statCard('Completed levels', formatNumber(summary.completed), `${formatNumber(catalog.levels.length)} rated platformers`, 'green')}
      ${statCard('Available moon reward', formatNumber(remainingMoons), `${formatNumber(available.length)} unfinished levels`, 'purple')}
      ${statCard('Estimated remaining time', formatDuration(remainingSeconds, { compact: true }), `${formatNumber(rate, 2)} moons per minute`, 'cyan')}
      ${statCard('Timed levels', formatNumber(timed.length), 'Ready to use in automatic grinds', 'blue')}
    </section>

    <section class="panel goal-panel">
      ${sectionHeading('Moon target', 'Your progress is stored only in this browser.', '<button class="button button-ghost button-small" data-route="settings">Edit target</button>')}
      ${progressBar(summary.currentMoons, Math.max(target, 1), `${formatNumber(summary.currentMoons)} of ${formatNumber(target)} moons`)}
    </section>

    <section class="split-layout overview-split">
      <div class="panel">
        ${sectionHeading('Next grinding blocks', `Fastest-first blocks of about ${formatNumber(state.settings.blockMinutes)} minutes.`, '<button class="button button-ghost button-small" data-route="planner">Open planner</button>')}
        <div class="block-list">
          ${blocks.slice(0, 8).map((block, index) => blockRow(block, index)).join('') || emptyState('No timed levels are available.')}
        </div>
      </div>
      <div class="panel">
        ${sectionHeading('Highest efficiency right now', 'Best moon gain among your unfinished levels.')}
        <div class="compact-level-list">
          ${best.map((level) => levelRow(catalog, level, state, { actions: false })).join('') || emptyState('No timed levels are available.')}
        </div>
      </div>
    </section>
  `;

  app.main.querySelectorAll('[data-action="start-block"]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.blockIndex);
      const block = app.currentBlocks[index];
      if (block) app.startSession(block.levels, `Block ${index + 1}`);
    });
  });
}

function blockRow(block, index) {
  return `<article class="block-row">
    <div class="block-index">${String(index + 1).padStart(2, '0')}</div>
    <div class="block-info"><strong>${formatNumber(block.levels.length)} levels</strong><span>${formatDuration(block.totalSeconds, { compact: true })} · ${formatNumber(block.totalMoons)} moons · ${formatNumber(block.rate, 2)}/min</span></div>
    <button class="button button-primary button-small" data-action="start-block" data-block-index="${index}">Start</button>
  </article>`;
}

function plannerFiltersFromState(app) {
  return app.viewState.plannerFilters || {
    difficulties: [],
    difficultyMoonGroups: [],
    ratings: [],
    moons: [],
    includeDeferred: app.state.settings.includeDeferredInPlans,
    maxDurationSeconds: 0,
  };
}

function renderPlanner(app) {
  const { catalog, state } = app;
  const filters = plannerFiltersFromState(app);
  const mode = app.viewState.plannerMode || 'time';
  const timeMinutes = app.viewState.plannerMinutes || state.settings.blockMinutes || 60;
  const moonTarget = app.viewState.plannerMoonTarget || Math.max(catalog.currentMoons(state) + 100, state.settings.targetMoons || 0);
  const strategy = app.viewState.plannerStrategy || state.settings.defaultStrategy || 'efficiency';
  const blockMinutes = app.viewState.blockMinutes || state.settings.blockMinutes;
  const blockStrategy = app.viewState.blockStrategy || 'shortest';

  app.main.innerHTML = `
    <section class="page-intro">
      <span class="eyebrow">Planner</span>
      <h1>Plan your next grind.</h1>
      <p>Choose how much time you have or how many moons you want.</p>
    </section>

    ${plannerExclusionNotice(state)}

    <section class="panel planner-panel">
      <div class="planner-tabs" role="tablist">
        <button class="planner-tab ${mode === 'time' ? 'active' : ''}" data-planner-mode="time">Time budget</button>
        <button class="planner-tab ${mode === 'goal' ? 'active' : ''}" data-planner-mode="goal">Moon goal</button>
      </div>

      <div class="planner-controls">
        ${mode === 'time' ? `
          <label class="field"><span>Minutes available</span><input id="planner-minutes" type="number" min="1" max="10080" value="${Number(timeMinutes)}"></label>
          <label class="field"><span>Strategy</span><select id="planner-strategy">${strategyOptions(strategy)}</select></label>
        ` : `
          <label class="field"><span>Target moon count</span><input id="planner-moon-target" type="number" min="1" max="1000000" value="${Number(moonTarget)}"></label>
          <div class="planner-current"><span>Current moons</span><strong>${formatNumber(catalog.currentMoons(state))}</strong></div>
        `}
        <button class="button button-primary" id="generate-plan">Generate plan</button>
      </div>

      <details class="filter-details">
        <summary>Advanced filters</summary>
        ${plannerFilterMarkup(filters)}
      </details>
    </section>

    <section id="planner-output" class="panel planner-output"></section>

    <section class="panel block-builder">
      ${sectionHeading('Grinding block builder', 'Split your unfinished levels into blocks of about the same length.')}
      <div class="inline-fields">
        <label class="field"><span>Minutes per block</span><input id="block-minutes" type="number" min="1" max="1440" value="${Number(blockMinutes)}"></label>
        <label class="field"><span>Block order</span><select id="block-strategy">${strategyOptions(blockStrategy)}</select></label>
        <button class="button button-secondary" id="build-blocks">Build blocks</button>
      </div>
      <div id="block-output" class="block-output"></div>
    </section>
  `;

  const readFilters = () => {
    const root = app.main.querySelector('.filter-details');
    const picked = (name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    return {
      difficulties: picked('difficulty'),
      difficultyMoonGroups: picked('difficulty-moon-group'),
      ratings: picked('rating'),
      moons: picked('moons').map(Number),
      includeDeferred: root.querySelector('#include-deferred')?.checked ?? true,
      maxDurationSeconds: parseWholeNumber(root.querySelector('#max-duration')?.value, 0, 0, 86400) * 60,
    };
  };

  const generate = () => {
    const nextFilters = readFilters();
    app.viewState.plannerFilters = nextFilters;
    let plan;
    if ((app.viewState.plannerMode || mode) === 'goal') {
      const target = parseWholeNumber(app.main.querySelector('#planner-moon-target')?.value, moonTarget, 1, 1000000);
      app.viewState.plannerMoonTarget = target;
      plan = buildMoonGoalPlan(catalog, state, target, nextFilters);
    } else {
      const minutes = parseWholeNumber(app.main.querySelector('#planner-minutes')?.value, timeMinutes, 1, 10080);
      const selectedStrategy = app.main.querySelector('#planner-strategy')?.value || strategy;
      app.viewState.plannerMinutes = minutes;
      app.viewState.plannerStrategy = selectedStrategy;
      plan = buildTimeBudgetPlan(catalog, state, minutes, selectedStrategy, nextFilters);
    }
    app.currentPlan = plan;
    renderPlanOutput(app, plan);
  };

  const buildBlockOutput = () => {
    const minutes = parseWholeNumber(app.main.querySelector('#block-minutes')?.value, blockMinutes, 1, 1440);
    const selectedStrategy = app.main.querySelector('#block-strategy')?.value || blockStrategy;
    app.viewState.blockMinutes = minutes;
    app.viewState.blockStrategy = selectedStrategy;
    const blocks = buildBlocks(catalog, state, minutes, selectedStrategy, readFilters());
    app.currentBlocks = blocks;
    const output = app.main.querySelector('#block-output');
    output.innerHTML = blocks.length ? `
      <div class="block-summary"><strong>${formatNumber(blocks.length)} blocks</strong><span>${formatNumber(blocks.reduce((sum, block) => sum + block.totalMoons, 0))} total moons in these blocks</span></div>
      <div class="block-list">${blocks.slice(0, 24).map((block, index) => blockRow(block, index)).join('')}</div>
      ${blocks.length > 24 ? `<p class="muted centered">Showing the first 24 of ${formatNumber(blocks.length)} blocks.</p>` : ''}
    ` : emptyState('No blocks could be built.', 'The current filters may exclude every timed level.');
    output.querySelectorAll('[data-action="start-block"]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.blockIndex);
        const block = blocks[index];
        if (block) app.startSession(block.levels, `Block ${index + 1}`);
      });
    });
  };

  app.main.querySelectorAll('[data-planner-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      app.viewState.plannerMode = button.dataset.plannerMode;
      renderPlanner(app);
    });
  });
  app.main.querySelector('#generate-plan').addEventListener('click', generate);
  app.main.querySelector('#build-blocks').addEventListener('click', buildBlockOutput);

  generate();
  buildBlockOutput();
}

function strategyOptions(selected) {
  return Object.entries(STRATEGIES).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function plannerFilterMarkup(filters) {
  const wholeDifficultyPills = DIFFICULTIES
    .filter((difficulty) => difficulty !== 'N/A')
    .map((difficulty) => pillCheckbox('difficulty', difficulty, difficulty, filters.difficulties.includes(difficulty)))
    .join('');

  const splitPills = PLANNER_DIFFICULTY_MOON_GROUPS
    .map((group) => pillCheckbox(
      'difficulty-moon-group',
      group.key,
      group.label,
      (filters.difficultyMoonGroups || []).includes(group.key),
    ))
    .join('');

  return `<div class="filter-grid">
    <div class="filter-group">
      <span class="filter-label">Difficulty</span>
      <div class="filter-pills">${wholeDifficultyPills}</div>
      <small class="filter-help">Use these for the normal full difficulty groups, exactly as before.</small>
    </div>
    <div class="filter-group filter-group-split">
      <span class="filter-label">Split Hard / Harder / Insane by reward</span>
      <div class="filter-pills">${splitPills}</div>
      <small class="filter-help">These are optional exact groups. For example, Hard · 4 moons and Hard · 5 moons can be planned separately. Whole and split difficulty picks are combined.</small>
    </div>
    <div class="filter-group"><span class="filter-label">Rating</span><div class="filter-pills">${RATINGS.map((rating) => pillCheckbox('rating', rating, rating, filters.ratings.includes(rating))).join('')}</div></div>
    <div class="filter-group"><span class="filter-label">Moon reward</span><div class="filter-pills">${Array.from({ length: 10 }, (_, index) => index + 1).map((moons) => pillCheckbox('moons', moons, String(moons), filters.moons.includes(moons))).join('')}</div></div>
    <div class="filter-group filter-inline-options"><label class="check-row"><input id="include-deferred" type="checkbox" ${filters.includeDeferred ? 'checked' : ''}><span>Include skipped levels</span></label><label class="field compact"><span>Maximum level time in minutes</span><input id="max-duration" type="number" min="0" max="1440" value="${filters.maxDurationSeconds ? Math.round(filters.maxDurationSeconds / 60) : 0}"><small>Use 0 for no limit.</small></label></div>
  </div>`;
}

function plannerExclusionNotice(state) {
  const excluded = state.settings.plannerExcludedDifficulties || [];
  if (!excluded.length) return '';
  return `<section class="planner-exclusion-notice">
    <div><strong>Demon exclusions active</strong><span>${excluded.map(escapeHtml).join(', ')} will not appear in planners or grinding blocks.</span></div>
    <button class="button button-ghost button-small" type="button" data-route="settings">Change</button>
  </section>`;
}

function renderPlanOutput(app, plan) {
  const output = app.main.querySelector('#planner-output');
  if (!plan?.levels?.length) {
    output.innerHTML = emptyState('No plan could be generated.', 'Try changing the filters.');
    return;
  }
  const goalDetail = plan.kind === 'goal'
    ? `Fastest route to ${formatNumber(plan.need)} more moons.`
    : `${escapeHtml(STRATEGIES[plan.strategy] || 'Planner')} inside the selected time budget.`;
  output.innerHTML = `
    ${planHeader(plan, plan.kind === 'goal' ? 'Moon goal' : 'Time budget', goalDetail)}
    <div class="plan-actions"><button class="button button-primary" id="start-current-plan">Start grinding</button><button class="button button-secondary" id="copy-current-plan">Copy level IDs</button></div>
    ${planLevelList(app.catalog, plan, app.state)}
  `;
  output.querySelector('#start-current-plan').addEventListener('click', () => app.startSession(plan.levels, plan.kind === 'goal' ? 'Moon Goal' : 'Quick Grind'));
  output.querySelector('#copy-current-plan').addEventListener('click', async () => {
    const text = plan.levels.map((level) => `${level.level_id}\t${level.name}`).join('\n');
    await app.copy(text, 'Plan copied to the clipboard.');
  });
}

function defaultCatalogFilters(app) {
  return app.viewState.catalogFilters || {
    query: '',
    difficulties: [],
    ratings: [],
    moons: [],
    statuses: [],
    timedOnly: false,
    maxDurationSeconds: 0,
    sort: 'duration',
    view: app.state.settings.compactCatalog ? 'list' : 'grid',
  };
}

function renderCatalog(app) {
  const { catalog, state } = app;
  const filters = defaultCatalogFilters(app);
  app.viewState.catalogLimit = app.viewState.catalogLimit || state.settings.catalogPageSize || 60;

  app.main.innerHTML = `
    <section class="page-intro catalog-intro">
      <div><span class="eyebrow">Catalog</span><h1>Rated platformer catalog.</h1><p>Search by level name, creator, or ID.</p></div>
    </section>

    <section class="catalog-toolbar panel">
      <div class="catalog-primary-controls">
        <label class="search-field"><span class="sr-only">Search catalog</span><input id="catalog-search" type="search" placeholder="Search name, creator, or Level ID" value="${escapeHtml(filters.query)}"></label>
        <label class="field compact"><span>Sort</span><select id="catalog-sort">${catalogSortOptions(filters.sort)}</select></label>
        <div class="segmented"><button class="${filters.view === 'grid' ? 'active' : ''}" data-catalog-view="grid">Cards</button><button class="${filters.view === 'list' ? 'active' : ''}" data-catalog-view="list">List</button></div>
      </div>
      <details class="filter-details catalog-filters">
        <summary>Filters</summary>
        <div class="filter-grid">
          <div class="filter-group"><span class="filter-label">Difficulty</span><div class="filter-pills">${DIFFICULTIES.filter((d) => d !== 'N/A').map((difficulty) => pillCheckbox('catalog-difficulty', difficulty, difficulty, filters.difficulties.includes(difficulty))).join('')}</div></div>
          <div class="filter-group"><span class="filter-label">Rating</span><div class="filter-pills">${RATINGS.map((rating) => pillCheckbox('catalog-rating', rating, rating, filters.ratings.includes(rating))).join('')}</div></div>
          <div class="filter-group"><span class="filter-label">Moon reward</span><div class="filter-pills">${Array.from({ length: 10 }, (_, index) => index + 1).map((moons) => pillCheckbox('catalog-moons', moons, String(moons), filters.moons.includes(moons))).join('')}</div></div>
          <div class="filter-group"><span class="filter-label">Your status</span><div class="filter-pills">${['available', 'completed', 'deferred', 'excluded'].map((status) => pillCheckbox('catalog-status', status, status === 'deferred' ? 'Skipped' : status[0].toUpperCase() + status.slice(1), filters.statuses.includes(status))).join('')}</div></div>
          <div class="filter-group filter-inline-options"><label class="check-row"><input id="catalog-timed-only" type="checkbox" ${filters.timedOnly ? 'checked' : ''}><span>Only timed levels</span></label><label class="field compact"><span>Maximum duration in minutes</span><input id="catalog-max-duration" type="number" min="0" max="1440" value="${filters.maxDurationSeconds ? Math.round(filters.maxDurationSeconds / 60) : 0}"></label></div>
        </div>
      </details>
    </section>

    <section class="catalog-results-head"><strong id="catalog-count"></strong><button class="button button-ghost button-small" id="catalog-clear-filters">Clear filters</button></section>
    <section id="catalog-results"></section>
    <div class="load-more-wrap"><button class="button button-secondary" id="catalog-load-more">Load more</button></div>
  `;

  const readFilters = () => {
    const checked = (name) => [...app.main.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    return {
      query: app.main.querySelector('#catalog-search').value,
      difficulties: checked('catalog-difficulty'),
      ratings: checked('catalog-rating'),
      moons: checked('catalog-moons').map(Number),
      statuses: checked('catalog-status'),
      timedOnly: app.main.querySelector('#catalog-timed-only').checked,
      maxDurationSeconds: parseWholeNumber(app.main.querySelector('#catalog-max-duration').value, 0, 0, 1440) * 60,
      sort: app.main.querySelector('#catalog-sort').value,
      view: app.viewState.catalogView || filters.view,
    };
  };

  const update = () => {
    const nextFilters = readFilters();
    app.viewState.catalogFilters = nextFilters;
    let rows = catalog.applyFilters(catalog.levels, nextFilters, state);
    rows = catalog.sort(rows, nextFilters.sort, state);
    const shown = rows.slice(0, app.viewState.catalogLimit);
    app.main.querySelector('#catalog-count').textContent = `${formatNumber(rows.length)} matching levels`;
    const results = app.main.querySelector('#catalog-results');
    results.className = nextFilters.view === 'grid' ? 'level-grid' : 'level-list';
    results.innerHTML = shown.length
      ? shown.map((level) => nextFilters.view === 'grid' ? levelCard(catalog, level, state) : levelRow(catalog, level, state)).join('')
      : emptyState('No levels match these filters.', 'Clear one or more filters and try again.');
    const loadMore = app.main.querySelector('#catalog-load-more');
    loadMore.hidden = shown.length >= rows.length;
  };

  const debouncedUpdate = debounce(() => {
    app.viewState.catalogLimit = state.settings.catalogPageSize || 60;
    update();
  }, 120);

  app.main.querySelector('#catalog-search').addEventListener('input', debouncedUpdate);
  app.main.querySelector('#catalog-sort').addEventListener('change', update);
  app.main.querySelector('.catalog-filters').addEventListener('change', () => {
    app.viewState.catalogLimit = state.settings.catalogPageSize || 60;
    update();
  });
  app.main.querySelectorAll('[data-catalog-view]').forEach((button) => button.addEventListener('click', () => {
    app.viewState.catalogView = button.dataset.catalogView;
    app.main.querySelectorAll('[data-catalog-view]').forEach((other) => other.classList.toggle('active', other === button));
    update();
  }));
  app.main.querySelector('#catalog-load-more').addEventListener('click', () => {
    app.viewState.catalogLimit += state.settings.catalogPageSize || 60;
    update();
  });
  app.main.querySelector('#catalog-clear-filters').addEventListener('click', () => {
    app.viewState.catalogFilters = null;
    app.viewState.catalogLimit = state.settings.catalogPageSize || 60;
    renderCatalog(app);
  });

  update();
}

function catalogSortOptions(selected) {
  const options = [
    ['duration', 'Estimated duration'], ['efficiency', 'Moons per minute'], ['moons', 'Moon reward'],
    ['rating', 'Rating tier'], ['id-new', 'Newest Level ID'],
    ['id-old', 'Oldest Level ID'], ['name', 'Name'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function renderGrind(app) {
  const session = app.state.activeSession;
  if (!session?.levelIds?.length) {
    app.main.innerHTML = `
      <section class="page-intro"><span class="eyebrow">Grind</span><h1>No active grind.</h1><p>Build a plan first, or start one of the blocks from the overview.</p><div class="hero-actions"><button class="button button-primary" data-route="planner">Open planner</button><button class="button button-secondary" data-route="overview">View blocks</button></div></section>
      <section class="panel">${emptyState('Your active session will appear here.', 'The timer, queue, skip, undo, and completion controls persist in this browser.')}</section>`;
    return;
  }

  const current = app.currentSessionLevel();
  if (!current) {
    app.finishSession();
    return;
  }
  const index = session.index || 0;
  const total = session.levelIds.length;
  const nextIds = session.levelIds.slice(index + 1, index + 7);
  const time = app.catalog.timeFor(current, app.state);

  app.main.innerHTML = `
    <section class="grind-header">
      <div><span class="eyebrow">Active grind</span><h1>${escapeHtml(session.name || 'Grinding Session')}</h1></div>
      <button class="button button-ghost" id="end-session">End session</button>
    </section>
    <section class="panel grind-progress-panel">
      ${progressBar(index, total, `${formatNumber(index)} of ${formatNumber(total)} levels finished in this queue`)}
    </section>
    <section class="grind-current-card">
      <div class="grind-face">${difficultyFace(current, 'xl')}</div>
      <div class="grind-current-main">
        <span class="eyebrow">Current level</span>
        <h2>${escapeHtml(current.name)}</h2>
        <p>by ${escapeHtml(current.creator || 'Unknown creator')} · ID ${escapeHtml(current.level_id)}</p>
        <div class="grind-meta">${moonReward(current.moons, 'large')} ${ratingBadge(current.rating)} <span class="difficulty-text">${escapeHtml(current.difficulty)}</span></div>
        <div class="grind-estimate"><span>Estimated clear time</span><strong>${formatDuration(time.seconds)}</strong></div>
      </div>
      <div class="grind-timer-wrap"><span>Current attempt timer</span><strong id="live-session-timer">${formatDuration(app.sessionElapsed(), { compact: false })}</strong><small>${session.timer?.paused ? 'Paused' : 'Running'}</small></div>
    </section>
    <section class="grind-controls">
      <button class="button button-primary button-large" id="complete-current">Complete and next</button>
      <button class="button button-secondary" id="copy-current-id">Copy Level ID</button>
      <button class="button button-secondary" id="skip-current">Skip</button>
      <button class="button button-secondary" id="undo-current" ${app.state.progress.lastCompletionStack.length ? '' : 'disabled'}>Undo</button>
      <button class="button button-secondary" id="pause-current">${session.timer?.paused ? 'Resume' : 'Pause'}</button>
    </section>
    <section class="panel upcoming-panel">
      ${sectionHeading('Up next', 'Skipped levels move to the end of the current queue.')}
      <div class="upcoming-list">${nextIds.map((id, offset) => {
        const level = app.catalog.get(id);
        if (!level) return '';
        return `<div class="upcoming-row"><span>${index + offset + 2}</span>${difficultyFace(level, 'xs')}<button data-action="level-detail" data-level-id="${level.level_id}"><strong>${escapeHtml(level.name)}</strong><small>${formatDuration(app.catalog.timeFor(level, app.state).seconds, { compact: true })} · ${formatNumber(level.moons)} moons</small></button></div>`;
      }).join('') || '<p class="muted">This is the last level in the queue.</p>'}</div>
    </section>
    <p class="keyboard-help">Keyboard shortcuts while this page is open: C complete, S skip, U undo, P pause, I copy Level ID.</p>
  `;

  app.main.querySelector('#complete-current').addEventListener('click', () => app.completeCurrent());
  app.main.querySelector('#copy-current-id').addEventListener('click', () => app.copy(current.level_id, 'Level ID copied.'));
  app.main.querySelector('#skip-current').addEventListener('click', () => app.skipCurrent());
  app.main.querySelector('#undo-current').addEventListener('click', () => app.undoCompletion());
  app.main.querySelector('#pause-current').addEventListener('click', () => app.togglePause());
  app.main.querySelector('#end-session').addEventListener('click', () => {
    if (confirm('End this grinding session now? Progress already completed will be kept.')) app.finishSession();
  });
}

function gdSavePreviewMarkup(app, options = {}) {
  const preview = app.viewState.gdImportPreview;
  if (!preview) return '';

  const currentCompleted = Object.keys(app.state.progress.completed || {}).length;
  const moonCount = preview.moonCount == null ? 'Unavailable' : formatNumber(preview.moonCount);
  const baseline = preview.baseline == null ? 'Unavailable' : formatNumber(preview.baseline);

  return `
    <section class="gd-save-preview ${options.compact ? 'compact' : ''}">
      <div class="gd-save-preview-heading">
        <div>
          <span class="eyebrow">Save ready</span>
          <h3>Geometry Dash save loaded</h3>
          <p>${escapeHtml(preview.fileName || 'CCGameManager.dat')}</p>
        </div>
        <span class="status-badge status-completed">Ready to sync</span>
      </div>
      <div class="gd-save-preview-stats">
        <div><span>Current moons</span><strong>${moonCount}</strong></div>
        <div><span>Rated platformers found</span><strong>${formatNumber(preview.matchedCatalogLevels || 0)}</strong></div>
        <div><span>Catalog moons in those clears</span><strong>${formatNumber(preview.matchedCatalogMoons || 0)}</strong></div>
        <div><span>Moon baseline</span><strong>${baseline}</strong></div>
      </div>
      <p class="gd-save-preview-note">MoonGrinder currently has ${formatNumber(currentCompleted)} completed catalog levels. Syncing replaces completed/uncompleted status for catalog levels, while sessions, personal time overrides, skipped levels, excluded levels, and other settings are kept.</p>
      ${preview.moonCount != null && preview.baseline != null ? `<p class="gd-save-baseline-explainer">The moon baseline is not your current moon count. MoonGrinder stores ${formatNumber(preview.baseline)} as the non-catalog baseline, then adds ${formatNumber(preview.matchedCatalogMoons || 0)} moons from completed catalog levels to reach ${formatNumber(preview.moonCount)} total moons.</p>` : ''}
      <div class="button-row gd-save-preview-actions">
        <button class="button button-primary" type="button" data-gd-sync>Sync progress</button>
        <button class="button button-secondary" type="button" data-gd-cancel>Choose another file</button>
      </div>
    </section>`;
}

function gdSaveLastSyncMarkup(app) {
  const sync = app.state.progress.gdImport;
  if (!sync || app.viewState.gdImportPreview) return '';
  const current = app.catalog.progressSummary(app.state);
  return `
    <div class="gd-save-last-sync">
      <div><span>Last GD save sync</span><strong>${formatDate(sync.importedAt)}</strong></div>
      <div><span>Current moon count</span><strong>${sync.moonCount == null ? formatNumber(current.currentMoons) : formatNumber(sync.moonCount)}</strong></div>
      <div><span>Completed rated platformers</span><strong>${formatNumber(sync.matchedCatalogLevels || 0)}</strong></div>
    </div>`;
}


function gdAuditCompletionSets(sync) {
  const raw = sync?.completedByPrefix || {};
  const sets = {};
  for (const [prefix, ids] of Object.entries(raw)) {
    sets[prefix] = new Set(Array.isArray(ids) ? ids.map(String) : []);
  }
  if (!sets['c_']) sets['c_'] = new Set((sync?.completedOnlineIdsList || []).map(String));
  return sets;
}

function gdAuditMarkers(id, sets) {
  const markers = [];
  const labels = {
    'c_': 'online', 'n_': 'official', 'd_': 'daily', 'g_': 'gauntlet', 'e_': 'event',
    'star_': 'star', 'dstar_': 'daily star', 'gstar_': 'gauntlet star',
    'demon_': 'demon', 'ddemon_': 'weekly demon', 'gdemon_': 'gauntlet demon',
  };
  for (const [prefix, label] of Object.entries(labels)) {
    if (sets[prefix]?.has(String(id))) markers.push(label);
  }
  return markers;
}

function moonAuditEffectLabel(row) {
  if (row.effect === 'missing') return `up to ${formatNumber(row.delta || 0)} potentially missing`;
  if (row.effect === 'extra') return `up to ${formatNumber(row.delta || 0)} possible extra`;
  return 'history / metadata check';
}

function moonAuditMarkup(app) {
  const sync = app.state.progress.gdImport;
  if (!sync) return '';

  const canMatchHistory = Boolean(sync.completedByPrefix || sync.completedOnlineIdsList);
  const sets = gdAuditCompletionSets(sync);
  const completedCurrent = Object.keys(app.state.progress.completed || {})
    .map((id) => app.catalog.get(id))
    .filter(Boolean);

  const difficultyCounts = {};
  for (const difficulty of DIFFICULTIES.filter((value) => value !== 'N/A')) difficultyCounts[difficulty] = 0;
  for (const level of completedCurrent) {
    const key = String(level.difficulty || 'Unknown');
    difficultyCounts[key] = (difficultyCounts[key] || 0) + 1;
  }

  const rows = MOON_AUDIT_LEVELS.map((item) => {
    const markers = gdAuditMarkers(item.id, sets);
    return {
      ...item,
      markers,
      detected: markers.length > 0,
      inCurrentCatalog: Boolean(app.catalog.get(item.id)),
    };
  });

  const detected = rows.filter((row) => row.detected);
  const possibleMissing = detected.filter((row) => row.effect === 'missing');
  const possibleExtra = detected.filter((row) => row.effect === 'extra');
  const possibleMissingDelta = possibleMissing.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const possibleExtraDelta = possibleExtra.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const currentCatalogMoons = Number(sync.matchedCatalogMoons || 0);
  const actualMoons = Number.isFinite(Number(sync.moonCount)) ? Number(sync.moonCount) : null;
  const baseline = actualMoons == null ? null : actualMoons - currentCatalogMoons;

  const difficultyHtml = Object.entries(difficultyCounts)
    .filter(([, count]) => count > 0)
    .map(([difficulty, count]) => `<div class="moon-audit-difficulty"><span>${escapeHtml(difficulty)}</span><strong>${formatNumber(count)}</strong></div>`)
    .join('');

  const detectedHtml = detected.length
    ? detected.map((row) => `<article class="moon-audit-hit ${row.effect}">
        <div class="moon-audit-hit-main">
          <div><strong>${escapeHtml(row.name)}</strong><span>ID ${escapeHtml(row.id)} · ${escapeHtml(row.markers.join(', '))}</span></div>
          <span class="moon-audit-effect ${row.effect}">${escapeHtml(moonAuditEffectLabel(row))}</span>
        </div>
        <p>${escapeHtml(row.note || '')}</p>
      </article>`).join('')
    : '<p class="muted">None of the built-in historical discrepancy candidates were detected in this save.</p>';

  const allRows = rows.map((row) => {
    const section = MOON_AUDIT_SECTION_LABELS[row.section] || row.section;
    const rewardChange = row.oldReward != null && row.newReward != null
      ? `${row.oldReward} → ${row.newReward}`
      : row.reward != null
        ? `${row.reward} moons`
        : row.delta != null
          ? `${row.delta} moons`
          : '-';
    return `<tr data-audit-row data-search="${escapeHtml(`${row.name} ${row.id} ${section} ${row.note || ''}`.toLowerCase())}" data-effect="${escapeHtml(row.effect)}" data-detected="${row.detected ? '1' : '0'}">
      <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(section)}</small></td>
      <td class="num">${escapeHtml(row.id)}</td>
      <td>${escapeHtml(rewardChange)}</td>
      <td>${row.detected ? `<span class="moon-audit-detected">Detected · ${escapeHtml(row.markers.join(', '))}</span>` : '<span class="muted">Not detected</span>'}</td>
      <td>${escapeHtml(moonAuditEffectLabel(row))}</td>
      <td class="moon-audit-notes">${escapeHtml(row.note || '')}${row.condition ? `<small>${escapeHtml(row.condition)}</small>` : ''}</td>
      <td><button class="button button-ghost button-small" type="button" data-copy-audit-id="${escapeHtml(row.id)}">Copy ID</button></td>
    </tr>`;
  }).join('');

  return `
    <section class="panel moon-audit-panel" id="moon-discrepancy-finder">
      ${sectionHeading('Moon discrepancy finder', 'Use your imported save to narrow down historical levels and rerates that can make the moon total disagree with the current rated-platformer catalog.')}
      <div class="moon-audit-credit">Historical discrepancy data: <strong>${escapeHtml(MOON_AUDIT_SOURCE_NAME)}</strong> spreadsheet.</div>

      ${!canMatchHistory ? '<div class="warning-box">Re-import CCGameManager.dat once with this version of MoonGrinder to enable historical completion matching.</div>' : ''}

      <div class="moon-audit-summary">
        <div><span>Save moon count</span><strong>${actualMoons == null ? 'Unavailable' : formatNumber(actualMoons)}</strong></div>
        <div><span>Current-catalog moons</span><strong>${formatNumber(currentCatalogMoons)}</strong></div>
        <div><span>Non-catalog baseline</span><strong>${baseline == null ? 'Unavailable' : formatNumber(baseline)}</strong></div>
        <div><span>Historical candidates detected</span><strong>${formatNumber(detected.length)}</strong></div>
        <div><span>Potential missing delta</span><strong>${formatNumber(possibleMissingDelta)}</strong></div>
        <div><span>Potential extra delta</span><strong>${formatNumber(possibleExtraDelta)}</strong></div>
      </div>

      <div class="moon-audit-explainer">
        <strong>Important:</strong> a completion marker tells MoonGrinder that you beat a level, but not which moon value was stored when you beat it. A rerated level can therefore be identified as a candidate, but the save alone cannot prove whether the old or new reward is the one affecting your total.
      </div>

      <div class="moon-audit-two-col">
        <div>
          <h3>Completed current platformers by difficulty</h3>
          <div class="moon-audit-difficulties">${difficultyHtml || '<span class="muted">No current catalog completions found.</span>'}</div>
        </div>
        <div>
          <h3>Detected historical candidates</h3>
          <div class="moon-audit-hits">${detectedHtml}</div>
        </div>
      </div>

      <details class="moon-audit-all" open>
        <summary>Search every known discrepancy level in the supplied spreadsheet data</summary>
        <div class="moon-audit-controls">
          <input id="moon-audit-search" type="search" placeholder="Search level name or ID">
          <select id="moon-audit-filter">
            <option value="all">All entries</option>
            <option value="detected">Detected in this save</option>
            <option value="missing">Potential missing moons</option>
            <option value="extra">Possible extra moons</option>
            <option value="history">History / metadata checks</option>
          </select>
          <span id="moon-audit-count" class="muted"></span>
        </div>
        <div class="table-wrap moon-audit-table-wrap">
          <table class="moon-audit-table">
            <thead><tr><th>Level</th><th>ID</th><th>Change</th><th>Save</th><th>What to check</th><th>Notes</th><th></th></tr></thead>
            <tbody>${allRows}</tbody>
          </table>
        </div>
      </details>
    </section>`;
}

function wireMoonAudit(app, root = app.main) {
  const search = root.querySelector('#moon-audit-search');
  const filter = root.querySelector('#moon-audit-filter');
  const count = root.querySelector('#moon-audit-count');
  const rows = [...root.querySelectorAll('[data-audit-row]')];
  if (search && filter) {
    const update = () => {
      const q = search.value.trim().toLowerCase();
      const mode = filter.value;
      let shown = 0;
      for (const row of rows) {
        const matchesText = !q || String(row.dataset.search || '').includes(q);
        const matchesFilter = mode === 'all'
          || (mode === 'detected' && row.dataset.detected === '1')
          || (mode === 'missing' && row.dataset.effect === 'missing')
          || (mode === 'extra' && row.dataset.effect === 'extra')
          || (mode === 'history' && row.dataset.effect === 'history');
        const visible = matchesText && matchesFilter;
        row.hidden = !visible;
        if (visible) shown += 1;
      }
      if (count) count.textContent = `${formatNumber(shown)} shown`;
    };
    search.addEventListener('input', update);
    filter.addEventListener('change', update);
    update();
  }

  root.querySelectorAll('[data-copy-audit-id]').forEach((button) => {
    button.addEventListener('click', () => app.copy(button.dataset.copyAuditId, 'Level ID copied.'));
  });
}

function wireGdSavePreviewActions(app, root = app.main) {
  root.querySelectorAll('[data-gd-sync]').forEach((button) => {
    button.addEventListener('click', () => app.syncGeometryDashSave());
  });
  root.querySelectorAll('[data-gd-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      app.clearGeometryDashImportPreview();
      setTimeout(() => app.main.querySelector('[data-gd-file-input]')?.click(), 0);
    });
  });
}

function wireGdDropzone(app, zone) {
  if (!zone) return;
  const input = zone.querySelector('[data-gd-file-input]');
  if (!input) return;

  const choose = () => input.click();
  zone.addEventListener('click', (event) => {
    if (event.target === input || event.target.closest('button')) return;
    choose();
  });
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose();
    }
  });
  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) app.importGeometryDashSave(file);
  });
  input.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) app.importGeometryDashSave(file);
    event.target.value = '';
  });
}

function renderProgress(app) {
  const { catalog, state } = app;
  const summary = catalog.progressSummary(state);
  const completed = Object.entries(state.progress.completed)
    .map(([id, data]) => ({ level: catalog.get(id), data }))
    .filter((item) => item.level)
    .sort((a, b) => String(b.data.at || '').localeCompare(String(a.data.at || '')));
  const deferred = state.progress.deferred.map((id) => catalog.get(id)).filter(Boolean);
  const excluded = state.progress.excluded.map((id) => catalog.get(id)).filter(Boolean);

  app.main.innerHTML = `
    <section class="page-intro progress-intro"><div><span class="eyebrow">Progress</span><h1>Your progress.</h1><p>Saved in this browser. Import CCGameManager.dat to sync completed rated platformers directly from Geometry Dash.</p></div><div class="hero-actions"><label class="button button-primary file-button">Import GD save<input id="import-gd-progress" type="file" accept=".dat,application/octet-stream"></label>${state.progress.gdImport ? '<button class="button button-secondary" data-route="moon-check">Moon Check</button>' : ''}<button class="button button-secondary" id="export-progress">Export save</button><label class="button button-secondary file-button">Import MoonGrinder save<input id="import-progress" type="file" accept="application/json,.json"></label></div></section>
    <section class="stat-grid four">
      ${statCard('Completed', formatNumber(summary.completed), `${formatNumber(summary.earnedMoons)} moons earned in tracked completions`, 'green')}
      ${statCard('Skipped', formatNumber(summary.deferred), 'Can still be included in automatic grinds', 'blue')}
      ${statCard('Excluded', formatNumber(summary.excluded), 'Never selected by automatic plans', 'purple')}
      ${statCard('Recorded clear time', formatDuration(summary.actualSeconds, { compact: true }), summary.actualSeconds ? `${formatNumber(summary.earnedMoons * 60 / summary.actualSeconds, 2)} recorded moons per minute` : 'Complete levels in a timed grind to record clear time', 'cyan')}
    </section>

    ${gdSavePreviewMarkup(app)}

    ${state.progress.gdImport ? `<section class="panel progress-section">${sectionHeading('Geometry Dash save sync')}<div class="method-row"><span>Last sync</span><strong>${formatDate(state.progress.gdImport.importedAt)}</strong></div><div class="method-row"><span>Matched rated platformers</span><strong>${formatNumber(state.progress.gdImport.matchedCatalogLevels || 0)}</strong></div><div class="method-row"><span>Moon count from save</span><strong>${state.progress.gdImport.moonCount == null ? 'Unavailable' : formatNumber(state.progress.gdImport.moonCount)}</strong></div></section>` : ''}


    <section class="panel progress-section">
      ${sectionHeading('Completed levels', 'Most recent completions appear first.')}
      <div class="history-list">${completed.slice(0, 100).map(({ level, data }) => `<article class="history-row">${difficultyFace(level, 'xs')}<button data-action="level-detail" data-level-id="${level.level_id}"><strong>${escapeHtml(level.name)}</strong><span>${formatDate(data.at)}</span></button>${moonReward(level.moons)}<span>${data.actualSeconds ? formatDuration(data.actualSeconds, { compact: true }) : 'No recorded timer'}</span><button class="button button-ghost button-small" data-action="toggle-completed" data-level-id="${level.level_id}">Undo</button></article>`).join('') || emptyState('No completed levels yet.', 'Start a grind from the planner to begin tracking progress.')}</div>
    </section>

    <section class="split-layout">
      <div class="panel progress-section">${sectionHeading('Skipped levels', 'Keep these out of automatic grinds without excluding them permanently.')}<div class="compact-level-list">${deferred.slice(0, 50).map((level) => levelRow(catalog, level, state)).join('') || emptyState('No skipped levels.')}</div></div>
      <div class="panel progress-section">${sectionHeading('Excluded levels', 'Excluded levels are never chosen by automatic planners.')}<div class="compact-level-list">${excluded.slice(0, 50).map((level) => levelRow(catalog, level, state)).join('') || emptyState('No excluded levels.')}</div></div>
    </section>

    <section class="panel progress-section">
      ${sectionHeading('Session history', 'The latest 100 finished sessions are kept in your browser.')}
      <div class="session-history">${state.sessions.slice(-100).reverse().map((session) => sessionHistoryRow(app, session)).join('') || emptyState('No finished sessions yet.')}</div>
    </section>
  `;

  app.main.querySelector('#export-progress').addEventListener('click', () => app.exportSave());
  app.main.querySelector('#import-progress').addEventListener('change', (event) => app.importSave(event.target.files?.[0]));
  app.main.querySelector('#import-gd-progress').addEventListener('change', (event) => app.importGeometryDashSave(event.target.files?.[0]));
  wireGdSavePreviewActions(app);
}

function sessionHistoryRow(app, session) {
  const completed = (session.log || []).filter((entry) => entry.result === 'completed');
  const moons = completed.reduce((sum, entry) => sum + Number(app.catalog.get(entry.levelId)?.moons || 0), 0);
  const seconds = completed.reduce((sum, entry) => sum + Number(entry.actualSeconds || 0), 0);
  return `<article class="session-row"><div><strong>${escapeHtml(session.name || 'Session')}</strong><span>${formatDate(session.startedAt)}</span></div><div><strong>${formatNumber(completed.length)}</strong><span>levels</span></div><div><strong>${formatNumber(moons)}</strong><span>moons</span></div><div><strong>${formatDuration(seconds, { compact: true })}</strong><span>recorded time</span></div><div><strong>${seconds ? `${formatNumber(moons * 60 / seconds, 2)}/min` : 'Unknown'}</strong><span>rate</span></div></article>`;
}

function renderStats(app) {
  const { catalog, state } = app;
  const stats = catalog.data.stats || {};
  const timed = catalog.levels.filter((level) => catalog.timeFor(level, state).seconds);
  const fastest = catalog.sort(timed, 'duration', state).slice(0, 10);
  const efficient = catalog.sort(timed, 'efficiency', state).slice(0, 10);
  const personal = catalog.progressSummary(state);
  const total = Number(stats.total_levels || catalog.levels.length) || 1;

  app.main.innerHTML = `
    <section class="page-intro stats-intro"><h1>Stats</h1></section>
    <section class="stat-grid four">
      ${statCard('Rated platformers', formatNumber(total), 'Levels in the catalog', 'purple')}
      ${statCard('Timed levels', formatNumber(timed.length), `${formatNumber((timed.length / total) * 100, 1)}% ready for planning`, 'cyan')}
      ${statCard('Total moon reward', formatNumber(catalog.levels.reduce((sum, level) => sum + Number(level.moons || 0), 0)), 'Across every rated platformer', 'blue')}
      ${statCard('Your completions', formatNumber(personal.completed), `${formatNumber(personal.earnedMoons)} moons earned`, 'green')}
    </section>

    <div class="stats-sections">
      <section class="split-layout stats-split">
        <div class="panel">${sectionHeading('Difficulty distribution')}<div class="bar-chart">${distributionBars(stats.difficulty_counts || {}, total)}</div></div>
        <div class="panel">${sectionHeading('Rating distribution')}<div class="bar-chart">${distributionBars(stats.rating_counts || {}, total)}</div></div>
      </section>
      <section class="split-layout stats-split">
        <div class="panel">${sectionHeading('Moon reward distribution')}<div class="bar-chart">${distributionBars(stats.moon_counts || {}, total, true)}</div></div>
        <div class="panel">${sectionHeading('Your progress')}<div class="bar-chart">${distributionBars({ Completed: personal.completed, Skipped: personal.deferred, Excluded: personal.excluded, Available: Math.max(0, total - personal.completed - personal.deferred - personal.excluded) }, total)}</div></div>
      </section>
      <section class="split-layout stats-split">
        <div class="panel">${sectionHeading('Fastest estimated clears')}<div class="compact-level-list">${fastest.map((level) => levelRow(catalog, level, state, { actions: false })).join('')}</div></div>
        <div class="panel">${sectionHeading('Highest estimated moon efficiency')}<div class="compact-level-list">${efficient.map((level) => levelRow(catalog, level, state, { actions: false })).join('')}</div></div>
      </section>
    </div>
  `;
}

function distributionBars(counts, total, numericLabels = false) {
  const entries = Object.entries(counts).sort((a, b) => numericLabels ? Number(a[0]) - Number(b[0]) : Number(b[1]) - Number(a[1]));
  const max = Math.max(1, ...entries.map(([, count]) => Number(count) || 0));
  return entries.map(([label, count]) => `<div class="bar-row"><span>${escapeHtml(label)}${numericLabels ? ' moons' : ''}</span><div class="bar-track"><div class="bar-fill" style="width:${(Number(count) / max * 100).toFixed(2)}%"></div></div><strong>${formatNumber(count)}</strong><small>${formatNumber(Number(count) / total * 100, 1)}%</small></div>`).join('');
}

function renderSettings(app) {
  const { state } = app;
  const gdSync = state.progress.gdImport;
  const baselineLabel = gdSync ? 'Non-catalog moon baseline' : 'Starting moon count';
  const baselineHelp = gdSync && gdSync.moonCount != null
    ? `MoonGrinder adds moons from completed catalog levels to this baseline. Your last imported GD save had ${formatNumber(gdSync.moonCount)} total moons.`
    : 'Set this to your in-game moon count before completions tracked by this website.';

  app.main.innerHTML = `
    <section class="page-intro"><h1>Settings</h1><p>Saved in this browser.</p></section>
    <form id="settings-form" class="settings-layout">
      <section class="panel settings-card">
        ${sectionHeading('Grinding')}
        <label class="field"><span>${baselineLabel}</span><input name="startingMoons" type="number" min="0" max="1000000" value="${Number(state.settings.startingMoons)}"><small>${baselineHelp}</small></label>
        <label class="field"><span>Target moon count</span><input name="targetMoons" type="number" min="0" max="1000000" value="${Number(state.settings.targetMoons)}"></label>
        <label class="field"><span>Default block length in minutes</span><input name="blockMinutes" type="number" min="1" max="1440" value="${Number(state.settings.blockMinutes)}"></label>
        <label class="field"><span>Default planner strategy</span><select name="defaultStrategy">${strategyOptions(state.settings.defaultStrategy)}</select></label>
      </section>
      <section class="panel settings-card">
        ${sectionHeading('Catalog and queues')}
        <label class="field"><span>Levels loaded per catalog page</span><input name="catalogPageSize" type="number" min="20" max="300" value="${Number(state.settings.catalogPageSize)}"></label>
        <label class="check-row"><input name="compactCatalog" type="checkbox" ${state.settings.compactCatalog ? 'checked' : ''}><span>Use list view by default in the catalog</span></label>
        <label class="check-row"><input name="includeDeferredInPlans" type="checkbox" ${state.settings.includeDeferredInPlans ? 'checked' : ''}><span>Include skipped levels in automatic grinds</span></label>
      </section>
      <section class="panel settings-card settings-planner-exclusions">
        ${sectionHeading('Planner exclusions', 'Hide demon tiers you do not want to grind. These exclusions apply to automatic planners and grinding blocks, but not to the catalog.')}
        <div class="settings-check-grid">
          ${DEMON_DIFFICULTIES.map((difficulty) => `<label class="check-row"><input name="plannerExcludedDifficulty" type="checkbox" value="${escapeHtml(difficulty)}" ${(state.settings.plannerExcludedDifficulties || []).includes(difficulty) ? 'checked' : ''}><span>Exclude ${escapeHtml(difficulty)}</span></label>`).join('')}
        </div>
        <small class="settings-note">Leave every box unchecked to use all demon difficulties.</small>
      </section>
      <section class="panel settings-card settings-local-data">
        <div class="panel-heading-row">
          <div>${sectionHeading('Geometry Dash save', 'Sync your completed rated platformers and current moon count directly from CCGameManager.dat.')}</div>
          ${gdSync ? '<button class="button button-secondary button-small" type="button" data-route="moon-check">Open Moon Check</button>' : ''}
        </div>
        <div class="gd-save-settings-grid">
          <div class="gd-save-dropzone gd-save-dropzone-large" id="settings-gd-dropzone" tabindex="0" role="button" aria-label="Choose or drop CCGameManager.dat">
            <input data-gd-file-input id="settings-import-gd" type="file" accept=".dat,application/octet-stream" hidden>
            <div class="gd-save-file-icon" aria-hidden="true"><span></span></div>
            <div class="gd-save-drop-title">Import your Geometry Dash save</div>
            <div class="gd-save-drop-subtitle">Drop <strong>CCGameManager.dat</strong> here or click to choose it</div>
            <p class="gd-save-private">Processed locally in your browser. Nothing is uploaded.</p>
          </div>
          <aside class="gd-save-help-card">
            <h3>Where to find it</h3>
            <div class="gd-save-paths gd-save-paths-cards">
              <div><strong>Windows</strong><code>%LOCALAPPDATA%\GeometryDash\CCGameManager.dat</code></div>
              <div><strong>macOS</strong><code>~/Library/Application Support/GeometryDash/CCGameManager.dat</code></div>
            </div>
            <div class="gd-save-kept-list"><strong>What stays untouched</strong><span>Sessions</span><span>Personal time overrides</span><span>Skipped and excluded levels</span><span>Planner settings</span></div>
          </aside>
        </div>
        ${gdSavePreviewMarkup(app, { compact: true })}
        ${gdSaveLastSyncMarkup(app)}
      </section>
      <section class="panel settings-card settings-local-data-secondary">
        ${sectionHeading('MoonGrinder data')}
        <p>Export a MoonGrinder save if you want a backup of your progress, sessions, overrides, and settings.</p>
        <div class="button-row local-data-actions three"><button class="button button-secondary" type="button" id="settings-export"><span>Export data</span></button><label class="button button-secondary file-button"><span>Import data</span><input id="settings-import" type="file" accept="application/json,.json"></label><button class="button button-danger" type="button" id="settings-reset"><span>Reset local data</span></button></div>
      </section>
      <div class="settings-save"><button class="button button-primary button-large" type="submit">Save settings</button></div>
    </form>
  `;

  const form = app.main.querySelector('#settings-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    state.settings.startingMoons = parseWholeNumber(data.get('startingMoons'), 0, 0, 1000000);
    state.settings.targetMoons = parseWholeNumber(data.get('targetMoons'), 1000, 0, 1000000);
    state.settings.blockMinutes = parseWholeNumber(data.get('blockMinutes'), 60, 1, 1440);
    state.settings.defaultStrategy = String(data.get('defaultStrategy') || 'efficiency');
    state.settings.catalogPageSize = parseWholeNumber(data.get('catalogPageSize'), 60, 20, 300);
    state.settings.compactCatalog = data.get('compactCatalog') === 'on';
    state.settings.includeDeferredInPlans = data.get('includeDeferredInPlans') === 'on';
    state.settings.plannerExcludedDifficulties = data.getAll('plannerExcludedDifficulty')
      .map(String)
      .filter((difficulty) => DEMON_DIFFICULTIES.includes(difficulty));
    app.save();
    app.toast('Settings saved.');
    app.render();
  });
  app.main.querySelector('#settings-export').addEventListener('click', () => app.exportSave());
  app.main.querySelector('#settings-import').addEventListener('change', (event) => app.importSave(event.target.files?.[0]));
  app.main.querySelector('#settings-reset').addEventListener('click', () => app.resetLocalData());
  wireGdDropzone(app, app.main.querySelector('#settings-gd-dropzone'));
  wireGdSavePreviewActions(app);
}

function renderAbout(app) {
  const data = app.catalog.data;
  const stats = data.stats || {};
  const timed = app.catalog.levels.filter((level) => app.catalog.timeFor(level, app.state).seconds).length;
  const totalMoons = app.catalog.levels.reduce((sum, level) => sum + Number(level.moons || 0), 0);
  app.main.innerHTML = `
    <section class="page-intro about-intro"><h1>About MoonGrinder</h1></section>
    <section class="about-grid">
      <article class="panel prose-card"><h2>What MoonGrinder does</h2><p>MoonGrinder helps you pick platformer levels when you want to grind moons. You can plan around the time you have, aim for a moon target, or split your unfinished levels into blocks.</p></article>
      <article class="panel prose-card"><h2>Estimated clear times</h2><p>Each timed level has one estimated clear time used by the planner. Levels without an estimate still appear in the catalog, but automatic grinds leave them out until a time is available or you set your own.</p></article>
      <article class="panel prose-card"><h2>Your progress</h2><p>Completed, skipped, and excluded levels are saved in this browser. Session history, custom level times, targets, and settings stay here too. You can export a save whenever you want a backup.</p></article>
      <article class="panel prose-card"><h2>How planning works</h2><p>Completed and excluded levels are left out automatically. Skipped levels can be included or ignored. Moon goal plans look for the fastest route to the amount you need, while time-budget plans follow the strategy you choose.</p></article>
    </section>
    <section class="panel methodology-table">
      ${sectionHeading('Catalog')}
      <div class="method-row"><span>Rated platformers</span><strong>${formatNumber(stats.total_levels || app.catalog.levels.length)}</strong></div>
      <div class="method-row"><span>Levels with estimated times</span><strong>${formatNumber(timed)}</strong></div>
      <div class="method-row"><span>Total moon reward</span><strong>${formatNumber(totalMoons)}</strong></div>
      <div class="method-row"><span>Last catalog update</span><strong>${formatDate(data.generated_at)}</strong></div>
    </section>
  `;
}
