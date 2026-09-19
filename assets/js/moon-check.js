import { DIFFICULTIES } from './constants.js';
import { emptyState, moonReward, sectionHeading, statCard } from './components.js';
import { escapeHtml, formatDate, formatNumber } from './utils.js';
import {
  MOON_AUDIT_LEVELS,
  MOON_AUDIT_SECTION_LABELS,
  MOON_AUDIT_SOURCE_NAME,
  MOON_FIXED_NONCATALOG_LEVELS,
} from './moon-audit-data.js';

function completionSets(sync) {
  const raw = sync?.completedByPrefix || {};
  const sets = {};
  for (const [prefix, ids] of Object.entries(raw)) {
    sets[prefix] = new Set(Array.isArray(ids) ? ids.map(String) : []);
  }
  if (!sets['c_']) sets['c_'] = new Set((sync?.completedOnlineIdsList || []).map(String));
  return sets;
}

function markerLabels(id, sets) {
  const labels = {
    'c_': 'online',
    'n_': 'official',
    'd_': 'daily',
    'g_': 'gauntlet',
    'e_': 'event',
    'star_': 'star',
    'dstar_': 'daily star',
    'gstar_': 'gauntlet star',
    'demon_': 'demon',
    'ddemon_': 'weekly demon',
    'gdemon_': 'gauntlet demon',
  };
  return Object.entries(labels)
    .filter(([prefix]) => sets[prefix]?.has(String(id)))
    .map(([, label]) => label);
}

function fixedLevelDetected(row, sets) {
  const prefixes = row.markerPrefixes || ['n_', 'c_'];
  return prefixes.some((prefix) => sets[prefix]?.has(String(row.id)));
}

function effectLabel(row) {
  if (row.effect === 'missing') return `Potential +${formatNumber(row.delta || 0)} moons`;
  if (row.effect === 'extra') return `Potential +${formatNumber(row.delta || 0)} extra moons`;
  return 'Historical check';
}

function rewardChange(row) {
  if (row.oldReward != null && row.newReward != null) return `${row.oldReward} -> ${row.newReward}`;
  if (row.reward != null) return `${row.reward} moons`;
  if (row.delta != null) return `${row.delta} moons`;
  return 'Unknown';
}

function buildAuditModel(app) {
  const sync = app.state.progress.gdImport;
  if (!sync) return null;

  const sets = completionSets(sync);
  const completedIds = new Set(Object.keys(app.state.progress.completed || {}).map(String));
  const actualMoons = Number.isFinite(Number(sync.moonCount)) ? Number(sync.moonCount) : null;
  const currentCatalogMoons = Number.isFinite(Number(sync.matchedCatalogMoons))
    ? Number(sync.matchedCatalogMoons)
    : [...completedIds].reduce((sum, id) => sum + Number(app.catalog.get(id)?.moons || 0), 0);

  const fixed = MOON_FIXED_NONCATALOG_LEVELS.map((row) => {
    const markers = markerLabels(row.id, sets);
    return { ...row, markers, detected: fixedLevelDetected(row, sets) };
  });
  const detectedFixed = fixed.filter((row) => row.detected);
  const knownNonCatalogMoons = detectedFixed.reduce((sum, row) => sum + Number(row.reward || 0), 0);

  const historical = MOON_AUDIT_LEVELS.map((row) => {
    const markers = markerLabels(row.id, sets);
    const completedCurrent = completedIds.has(String(row.id));
    return {
      ...row,
      markers,
      completedCurrent,
      detected: markers.length > 0 || completedCurrent,
      inCurrentCatalog: Boolean(app.catalog.get(row.id)),
    };
  });

  const extraCandidates = historical.filter((row) => row.effect === 'extra' && row.detected);
  const reloadCandidates = historical.filter((row) => row.effect === 'missing' && row.detected);
  const historyCandidates = historical.filter((row) => row.effect === 'history' && row.detected);

  const nonCatalogBaseline = actualMoons == null ? null : actualMoons - currentCatalogMoons;
  const unexplainedAfterKnown = nonCatalogBaseline == null ? null : nonCatalogBaseline - knownNonCatalogMoons;
  const possibleExtraTotal = extraCandidates.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const possibleMissingTotal = reloadCandidates.reduce((sum, row) => sum + Number(row.delta || 0), 0);

  const difficultyCounts = {};
  for (const difficulty of DIFFICULTIES.filter((value) => value !== 'N/A')) difficultyCounts[difficulty] = 0;
  for (const id of completedIds) {
    const level = app.catalog.get(id);
    if (!level) continue;
    const difficulty = String(level.difficulty || 'Unknown');
    difficultyCounts[difficulty] = (difficultyCounts[difficulty] || 0) + 1;
  }

  return {
    sync,
    sets,
    actualMoons,
    currentCatalogMoons,
    fixed,
    detectedFixed,
    knownNonCatalogMoons,
    historical,
    extraCandidates,
    reloadCandidates,
    historyCandidates,
    nonCatalogBaseline,
    unexplainedAfterKnown,
    possibleExtraTotal,
    possibleMissingTotal,
    difficultyCounts,
  };
}

function exactExtraCombinations(candidates, target, limit = 10) {
  if (!Number.isInteger(target) || target <= 0) return [];

  const usable = [];
  const seen = new Set();
  for (const row of candidates) {
    const value = Number(row.delta || 0);
    const id = String(row.id);
    if (!Number.isInteger(value) || value <= 0 || seen.has(id)) continue;
    seen.add(id);
    usable.push({ ...row, delta: value });
  }

  const paths = new Map([[0, [[]]]]);
  for (const item of usable) {
    const snapshot = [...paths.entries()].sort((a, b) => b[0] - a[0]);
    for (const [sum, combinations] of snapshot) {
      const next = sum + item.delta;
      if (next > target) continue;
      const bucket = paths.get(next) || [];
      for (const combo of combinations) {
        if (bucket.length >= limit) break;
        bucket.push([...combo, item]);
      }
      paths.set(next, bucket);
    }
  }

  return (paths.get(target) || [])
    .sort((a, b) => a.length - b.length || a.map((x) => x.id).join(',').localeCompare(b.map((x) => x.id).join(',')))
    .slice(0, limit);
}

function saveDropzoneMarkup(id) {
  return `<div class="gd-save-dropzone gd-save-dropzone-large" id="${id}" tabindex="0" role="button" aria-label="Choose or drop CCGameManager.dat">
    <input data-gd-file-input type="file" accept=".dat,application/octet-stream" hidden>
    <div class="gd-save-file-icon" aria-hidden="true"><span></span></div>
    <div class="gd-save-drop-title">Import your Geometry Dash save</div>
    <div class="gd-save-drop-subtitle">Drop <strong>CCGameManager.dat</strong> here or click to choose it</div>
    <div class="gd-save-paths gd-save-paths-cards">
      <div><strong>Windows</strong><code>%LOCALAPPDATA%\GeometryDash\CCGameManager.dat</code></div>
      <div><strong>macOS</strong><code>~/Library/Application Support/GeometryDash/CCGameManager.dat</code></div>
    </div>
    <p class="gd-save-private">Processed locally in your browser. The save file is never uploaded.</p>
  </div>`;
}

function wireDropzone(app, zone) {
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

function previewMarkup(app) {
  const preview = app.viewState.gdImportPreview;
  if (!preview) return '';
  return `<section class="panel gd-save-inline-preview">
    <div class="panel-heading-row">
      <div>${sectionHeading('Save ready to sync', escapeHtml(preview.fileName || 'CCGameManager.dat'))}</div>
      <span class="status-pill good">Parsed successfully</span>
    </div>
    <div class="stat-grid four moon-check-preview-grid">
      ${statCard('Moon count', preview.moonCount == null ? 'Unavailable' : formatNumber(preview.moonCount), 'Read from the save', 'purple')}
      ${statCard('Rated platformers', formatNumber(preview.matchedCatalogLevels || 0), 'Completed in the current catalog', 'green')}
      ${statCard('Catalog moons', formatNumber(preview.matchedCatalogMoons || 0), 'Current rewards for those levels', 'cyan')}
      ${statCard('Non-catalog baseline', preview.baseline == null ? 'Unavailable' : formatNumber(preview.baseline), 'Everything not explained by the current catalog', 'blue')}
    </div>
    <p class="moon-check-callout">Syncing updates completed and unfinished catalog levels. Your sessions, personal time overrides, skipped levels, excluded levels, and other settings are kept.</p>
    <div class="button-row">
      <button class="button button-primary" type="button" id="moon-check-sync-preview">Sync progress</button>
      <button class="button button-secondary" type="button" id="moon-check-choose-again">Choose another file</button>
    </div>
  </section>`;
}

function fixedSourceRows(model) {
  return model.fixed.map((row) => `<article class="moon-source-row ${row.detected ? 'detected' : ''}">
    <div class="moon-source-main">
      <span class="moon-source-check" aria-hidden="true">${row.detected ? '✓' : ''}</span>
      <div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.difficulty)} · official Tower level</span></div>
    </div>
    <div class="moon-source-reward">${moonReward(row.reward)}<span>${row.detected ? 'Detected in save' : 'Not detected'}</span></div>
  </article>`).join('');
}

function extraCandidateCard(row) {
  const section = MOON_AUDIT_SECTION_LABELS[row.section] || row.section;
  const evidence = row.markers.length ? row.markers.join(', ') : row.completedCurrent ? 'current catalog completion' : 'manual check';
  return `<article class="moon-case-card extra" data-moon-case data-search="${escapeHtml(`${row.name} ${row.id} ${section} ${row.note || ''}`.toLowerCase())}">
    <div class="moon-case-top">
      <div><span class="moon-case-kicker">${escapeHtml(section)}</span><h3>${escapeHtml(row.name)}</h3><p>ID ${escapeHtml(row.id)}</p></div>
      <span class="moon-delta extra">+${formatNumber(row.delta || 0)}</span>
    </div>
    <p class="moon-case-summary">${escapeHtml(row.note || 'This level can leave extra moons on older saves.')}</p>
    <div class="moon-case-meta"><span>Evidence: ${escapeHtml(evidence)}</span><span>${escapeHtml(rewardChange(row))}</span></div>
    <div class="moon-case-actions"><button class="button button-secondary button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>
  </article>`;
}

function reloadCandidateCard(row) {
  const evidence = row.markers.length ? row.markers.join(', ') : row.completedCurrent ? 'completed in current catalog' : 'save match';
  return `<article class="moon-case-card missing" data-moon-reload data-search="${escapeHtml(`${row.name} ${row.id} ${row.note || ''}`.toLowerCase())}">
    <div class="moon-case-top">
      <div><span class="moon-case-kicker">Reward increased</span><h3>${escapeHtml(row.name)}</h3><p>ID ${escapeHtml(row.id)}</p></div>
      <span class="moon-delta missing">+${formatNumber(row.delta || 0)} possible</span>
    </div>
    <div class="reward-change"><span>${formatNumber(row.oldReward || 0)} moons</span><i></i><strong>${formatNumber(row.newReward || 0)} moons</strong></div>
    <p class="moon-case-summary">Reload this level in Geometry Dash. If your save still has the older reward registered, opening or redownloading it can update the stored moon value.</p>
    <div class="moon-case-meta"><span>Evidence: ${escapeHtml(evidence)}</span></div>
    <div class="moon-case-actions"><button class="button button-primary button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>
  </article>`;
}

function allCaseRow(row) {
  const section = MOON_AUDIT_SECTION_LABELS[row.section] || row.section;
  const status = row.detected ? 'Detected' : 'Not detected';
  const statusClass = row.detected ? 'good' : 'muted';
  return `<tr data-all-moon-row data-search="${escapeHtml(`${row.name} ${row.id} ${section} ${row.note || ''}`.toLowerCase())}" data-effect="${escapeHtml(row.effect)}" data-detected="${row.detected ? '1' : '0'}">
    <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(section)}</small></td>
    <td class="num">${escapeHtml(row.id)}</td>
    <td>${escapeHtml(rewardChange(row))}</td>
    <td><span class="status-text ${statusClass}">${status}</span></td>
    <td>${escapeHtml(effectLabel(row))}</td>
    <td class="moon-check-table-note">${escapeHtml(row.note || '')}${row.condition ? `<small>${escapeHtml(row.condition)}</small>` : ''}</td>
    <td><button class="button button-ghost button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></td>
  </tr>`;
}

function difficultyBars(model, app) {
  const entries = Object.entries(model.difficultyCounts).filter(([, count]) => count > 0);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return entries.map(([difficulty, count]) => {
    const total = app.catalog.levels.filter((level) => String(level.difficulty) === difficulty).length;
    const pct = total ? count / total * 100 : 0;
    return `<div class="moon-difficulty-row"><div><span>${escapeHtml(difficulty)}</span><strong>${formatNumber(count)} / ${formatNumber(total)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, pct).toFixed(2)}%"></div></div></div>`;
  }).join('');
}

function explanationMarkup(model) {
  const target = model.unexplainedAfterKnown;
  if (target == null) return '';
  if (target <= 0) {
    return `<div class="moon-answer good-answer"><strong>No positive unexplained gap remains after known non-catalog sources.</strong><p>The save total is fully covered, or lower than the current-catalog plus detected fixed-source total.</p></div>`;
  }

  const combos = exactExtraCombinations(model.extraCandidates, target);
  if (!combos.length) {
    return `<div class="moon-answer"><strong>${formatNumber(target)} moons are still not explained by fixed known sources.</strong><p>MoonGrinder did not find an exact combination among the historical extra-moon candidates detected in this save. Check the candidate cards below, especially old unrates and reward decreases.</p></div>`;
  }

  const list = combos.map((combo, index) => {
    const names = combo.map((row) => `${row.name} (+${row.delta})`).join(' + ');
    return `<li><span>#${index + 1}</span><strong>${escapeHtml(names)}</strong></li>`;
  }).join('');
  return `<div class="moon-answer exact-answer"><strong>MoonGrinder found ${formatNumber(combos.length)} exact known combination${combos.length === 1 ? '' : 's'} for the remaining ${formatNumber(target)} moons.</strong><p>These are candidates, not proof. A completion marker does not record which historical reward value your save kept.</p><ol class="moon-combination-list">${list}</ol></div>`;
}

function renderNoSave(app) {
  app.main.innerHTML = `
    <section class="page-intro moon-check-intro"><div><span class="eyebrow">Moon Check</span><h1>Find where your moon count comes from.</h1><p>Import your Geometry Dash save to separate current rated-platformer moons from official, historical, rerated, and potentially missing moons.</p></div></section>
    <section class="panel moon-check-import-panel">
      ${sectionHeading('Start with your Geometry Dash save', 'MoonGrinder needs CCGameManager.dat to match completion markers against the current catalog and known historical cases.')}
      ${saveDropzoneMarkup('moon-check-dropzone')}
    </section>
    ${previewMarkup(app)}
    <section class="panel moon-credit-panel"><strong>Historical discrepancy data</strong><p>Known unrates, rerates, glitches, and metadata cases are based on the <strong>${escapeHtml(MOON_AUDIT_SOURCE_NAME)}</strong> spreadsheet.</p></section>`;

  wireDropzone(app, app.main.querySelector('#moon-check-dropzone'));
  wirePreview(app);
}

function wirePreview(app) {
  app.main.querySelector('#moon-check-sync-preview')?.addEventListener('click', () => app.syncGeometryDashSave());
  app.main.querySelector('#moon-check-choose-again')?.addEventListener('click', () => {
    app.clearGeometryDashImportPreview();
    setTimeout(() => app.main.querySelector('#moon-check-dropzone [data-gd-file-input]')?.click(), 0);
  });
}

function wireCommon(app, model) {
  app.main.querySelectorAll('[data-copy-moon-id]').forEach((button) => {
    button.addEventListener('click', () => app.copy(button.dataset.copyMoonId, 'Level ID copied.'));
  });

  app.main.querySelector('#copy-reload-ids')?.addEventListener('click', () => {
    const ids = model.reloadCandidates.map((row) => row.id).join('\n');
    app.copy(ids, 'Reload candidate IDs copied.');
  });

  app.main.querySelector('#copy-extra-ids')?.addEventListener('click', () => {
    const ids = model.extraCandidates.map((row) => row.id).join('\n');
    app.copy(ids, 'Extra-moon candidate IDs copied.');
  });

  const search = app.main.querySelector('#all-moon-search');
  const filter = app.main.querySelector('#all-moon-filter');
  const count = app.main.querySelector('#all-moon-count');
  const rows = [...app.main.querySelectorAll('[data-all-moon-row]')];
  if (search && filter) {
    const update = () => {
      const q = search.value.trim().toLowerCase();
      const mode = filter.value;
      let shown = 0;
      for (const row of rows) {
        const matchesText = !q || String(row.dataset.search || '').includes(q);
        const matchesMode = mode === 'all'
          || (mode === 'detected' && row.dataset.detected === '1')
          || row.dataset.effect === mode;
        const visible = matchesText && matchesMode;
        row.hidden = !visible;
        if (visible) shown += 1;
      }
      if (count) count.textContent = `${formatNumber(shown)} shown`;
    };
    search.addEventListener('input', update);
    filter.addEventListener('change', update);
    update();
  }

  app.main.querySelector('#moon-check-new-save')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) app.importGeometryDashSave(file);
    event.target.value = '';
  });

  wirePreview(app);
}

export function renderMoonCheck(app) {
  if (!app.state.progress.gdImport) {
    renderNoSave(app);
    return;
  }

  const model = buildAuditModel(app);
  if (!model) {
    renderNoSave(app);
    return;
  }

  const sync = model.sync;
  const fixedDetected = model.detectedFixed.length;
  const extraCards = model.extraCandidates.length
    ? model.extraCandidates.map(extraCandidateCard).join('')
    : emptyState('No known extra-moon candidates were detected.', 'That does not prove the non-catalog gap is zero. Some historical cases cannot be reconstructed perfectly from completion markers alone.');
  const reloadCards = model.reloadCandidates.length
    ? model.reloadCandidates.map(reloadCandidateCard).join('')
    : emptyState('No completed reward-increase levels need checking.', 'None of the known rerated-up levels were matched as completed in this save.');

  const allRows = model.historical.map(allCaseRow).join('');
  const fixedRows = fixedSourceRows(model);
  const baselineText = model.nonCatalogBaseline == null ? 'Unavailable' : formatNumber(model.nonCatalogBaseline);
  const unexplainedText = model.unexplainedAfterKnown == null ? 'Unavailable' : formatNumber(model.unexplainedAfterKnown);

  app.main.innerHTML = `
    <section class="page-intro moon-check-intro">
      <div><span class="eyebrow">Moon Check</span><h1>Explain your moon count.</h1><p>See what is definitely accounted for, which old levels could be leaving extra moons, and which completed levels are worth reloading for potentially missing moons.</p></div>
      <div class="hero-actions"><label class="button button-secondary file-button">Import newer save<input id="moon-check-new-save" type="file" accept=".dat,application/octet-stream"></label></div>
    </section>

    ${previewMarkup(app)}

    <section class="stat-grid four moon-check-stats">
      ${statCard('Moons in save', model.actualMoons == null ? 'Unavailable' : formatNumber(model.actualMoons), `Last synced ${formatDate(sync.importedAt)}`, 'purple')}
      ${statCard('Current catalog', formatNumber(model.currentCatalogMoons), `${formatNumber(sync.matchedCatalogLevels || 0)} completed rated platformers`, 'green')}
      ${statCard('Known non-catalog', formatNumber(model.knownNonCatalogMoons), `${formatNumber(fixedDetected)} fixed source${fixedDetected === 1 ? '' : 's'} detected`, 'cyan')}
      ${statCard('Still unexplained', unexplainedText, `Non-catalog baseline: ${baselineText}`, model.unexplainedAfterKnown > 0 ? 'orange' : 'blue')}
    </section>

    <section class="panel moon-check-guide">
      <div class="moon-guide-copy">
        <span class="eyebrow">What to do</span>
        <h2>Use the page in this order.</h2>
        <p>MoonGrinder first removes moons it can explain exactly, then highlights old levels that could explain extra moons, then gives you a reload list for known reward increases.</p>
      </div>
      <div class="moon-guide-steps">
        <div><span>1</span><strong>Known sources</strong><p>Official platformer moons outside the online catalog are counted directly when the save proves you completed them.</p></div>
        <div><span>2</span><strong>Extra or unobtainable moons</strong><p>Detected unrates, glitches, and reward decreases are shown as candidates for moons your save may still retain.</p></div>
        <div><span>3</span><strong>Potentially missing moons</strong><p>Reload completed levels whose moon reward increased so Geometry Dash can register the newer value.</p></div>
      </div>
    </section>

    <section class="split-layout moon-check-top-split">
      <article class="panel">
        ${sectionHeading('Known non-catalog moon sources', 'These can be detected directly from completion markers and are not part of the online rated-platformer catalog.')}
        <div class="moon-source-list">${fixedRows}</div>
        <div class="moon-source-total"><span>Detected fixed-source total</span><strong>${formatNumber(model.knownNonCatalogMoons)} moons</strong></div>
      </article>
      <article class="panel">
        ${sectionHeading('Current completions by difficulty', 'Calculated by matching completed online IDs to the current MoonGrinder catalog.')}
        <div class="moon-difficulty-bars">${difficultyBars(model, app)}</div>
      </article>
    </section>

    <section class="panel moon-check-answer-panel">
      ${sectionHeading('Where the remaining extra moons could come from', 'MoonGrinder compares the unexplained part of your save against historical cases that were actually detected.')}
      ${explanationMarkup(model)}
    </section>

    <section class="panel moon-check-section" id="extra-moons">
      <div class="panel-heading-row">
        <div>${sectionHeading('Possible extra or unobtainable moons', 'These levels were detected in your save and can leave old or no-longer-obtainable moon value behind.')}</div>
        ${model.extraCandidates.length ? `<button class="button button-secondary button-small" id="copy-extra-ids">Copy all IDs</button>` : ''}
      </div>
      <div class="moon-case-grid">${extraCards}</div>
      <p class="moon-section-footnote">For rerated levels, completion data proves that you beat the level, but not whether your save kept the old reward or the current reward.</p>
    </section>

    <section class="panel moon-check-section" id="reload-moons">
      <div class="panel-heading-row">
        <div>${sectionHeading('Levels to reload for potentially missing moons', 'These completed levels are known to have had their moon reward increased. Open or redownload them in Geometry Dash and check whether your total changes.')}</div>
        ${model.reloadCandidates.length ? `<button class="button button-primary button-small" id="copy-reload-ids">Copy all IDs</button>` : ''}
      </div>
      <div class="moon-case-grid">${reloadCards}</div>
      <p class="moon-section-footnote">Reload candidates are based on reward increases documented in the ${escapeHtml(MOON_AUDIT_SOURCE_NAME)} spreadsheet.</p>
    </section>

    ${model.historyCandidates.length ? `<section class="panel moon-check-section">${sectionHeading('Other detected historical cases', 'These are worth knowing about, but MoonGrinder cannot assign a reliable moon delta from the save alone.')}<div class="moon-history-list">${model.historyCandidates.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>ID ${escapeHtml(row.id)}</span><p>${escapeHtml(row.note || '')}</p><button class="button button-ghost button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>`).join('')}</div></section>` : ''}

    <section class="panel moon-check-section">
      <div class="panel-heading-row">
        <div>${sectionHeading('All known historical cases', `Search the full set of discrepancy entries currently included from the ${escapeHtml(MOON_AUDIT_SOURCE_NAME)} spreadsheet.`)}</div>
        <span id="all-moon-count" class="muted"></span>
      </div>
      <div class="moon-check-filters">
        <input id="all-moon-search" type="search" placeholder="Search level name or ID">
        <select id="all-moon-filter">
          <option value="all">All cases</option>
          <option value="detected">Detected in this save</option>
          <option value="extra">Possible extra moons</option>
          <option value="missing">Potential missing moons</option>
          <option value="history">Historical / metadata</option>
        </select>
      </div>
      <div class="table-wrap moon-check-table-wrap"><table class="moon-check-table"><thead><tr><th>Level</th><th>ID</th><th>Change</th><th>Your save</th><th>Meaning</th><th>Notes</th><th></th></tr></thead><tbody>${allRows}</tbody></table></div>
    </section>

    <section class="panel moon-credit-panel">
      <strong>Data credit</strong>
      <p>Historical unrates, rerates, glitches, and metadata notes are based on the <strong>${escapeHtml(MOON_AUDIT_SOURCE_NAME)}</strong> spreadsheet. MoonGrinder uses the imported save only to match those known cases against your completion markers.</p>
    </section>
  `;

  wireCommon(app, model);
}
