import { DIFFICULTIES } from './constants.js';
import { emptyState, sectionHeading, statCard } from './components.js';
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
  if (row.specialObtainable) return row.detected
    ? `Special +${formatNumber(row.delta || 0)} non-catalog moons`
    : `Special obtainable +${formatNumber(row.delta || 0)} moons`;
  if (row.confirmedExtra) return `Confirmed +${formatNumber(row.delta || 0)} unobtainable moons`;
  if (row.effect === 'missing' && row.alreadyCurrent) return 'Current reward already stored';
  if (row.effect === 'missing' && row.needsReloadStrong) return `Reload recommended: +${formatNumber(row.delta || 0)} possible`;
  if (row.effect === 'extra' && row.oldRewardRuledOut) return 'Old reward not stored';
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

function gdMoonAmount(value, { prefix = '', small = false } = {}) {
  return `<span class="gd-moon-amount ${small ? 'small' : ''}"><strong>${escapeHtml(prefix)}${formatNumber(value || 0)}</strong><img src="./assets/images/moon.png" alt="moons"></span>`;
}

function strictMarkerDetected(row, sets) {
  const prefixes = Array.isArray(row.matchPrefixes) ? row.matchPrefixes : [];
  if (!prefixes.length) return null;
  return prefixes.some((prefix) => sets[prefix]?.has(String(row.id)));
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function saveEvidenceMaps(sync) {
  const evidence = sync?.saveEvidence || {};
  const snapshots = evidence.levelSnapshots || {};
  return {
    available: Boolean(sync?.saveEvidence),
    rewardByLevel: evidence.rewardByLevel || {},
    timelyRewardById: evidence.timelyRewardById || {},
    online: snapshots.online || {},
    daily: snapshots.daily || {},
    gauntlet: snapshots.gauntlet || {},
  };
}

function pushRewardEvidence(items, source, value, technical) {
  const numeric = finiteNumber(value);
  if (numeric == null) return;
  if (items.some((item) => item.source === source && item.value === numeric)) return;
  items.push({ source, value: numeric, technical });
}

function rewardEvidenceForRow(row, sync) {
  const maps = saveEvidenceMaps(sync);
  const id = String(row.id);
  const items = [];
  const online = maps.online[id] || null;
  const daily = maps.daily[id] || null;
  const gauntlet = maps.gauntlet[id] || null;

  pushRewardEvidence(items, 'Stored level reward', maps.rewardByLevel[id], 'GS_9');
  pushRewardEvidence(items, 'Cached online level', online?.reward, 'GLM_03 k26');
  pushRewardEvidence(items, 'Cached Daily level', daily?.reward, 'GLM_10 k26');
  pushRewardEvidence(items, 'Cached Gauntlet level', gauntlet?.reward, 'GLM_16 k26');

  const timelyId = finiteNumber(daily?.timelyId);
  if (timelyId != null) {
    pushRewardEvidence(items, 'Daily reward registry', maps.timelyRewardById[String(Math.trunc(timelyId))], `GS_17 timely ${Math.trunc(timelyId)}`);
  }

  // Prefer the reward registry over cached level metadata. For Daily levels,
  // the timely reward registry is the most specific piece of evidence.
  let decisive = null;
  if (Array.isArray(row.matchPrefixes) && row.matchPrefixes.includes('d_')) {
    decisive = items.find((item) => item.source === 'Daily reward registry')
      || items.find((item) => item.source === 'Cached Daily level')
      || null;
  }
  decisive = decisive
    || items.find((item) => item.source === 'Stored level reward')
    || items.find((item) => item.source === 'Cached online level')
    || items.find((item) => item.source === 'Cached Gauntlet level')
    || items[0]
    || null;

  const historicalReward = row.oldReward != null
    ? Number(row.oldReward)
    : row.effect === 'extra'
      ? finiteNumber(row.reward ?? row.delta)
      : null;
  const currentReward = row.newReward != null ? Number(row.newReward) : null;

  const values = items.map((item) => item.value);
  const hasHistorical = historicalReward != null && values.includes(historicalReward);
  const hasCurrent = currentReward != null && values.includes(currentReward);
  const decisiveHistorical = decisive && historicalReward != null && decisive.value === historicalReward;
  const decisiveCurrent = decisive && currentReward != null && decisive.value === currentReward;

  let state = 'unknown';
  if (decisiveHistorical && !decisiveCurrent) state = 'historical';
  else if (decisiveCurrent && !decisiveHistorical) state = 'current';
  else if (hasHistorical && hasCurrent) state = 'mixed';
  else if (hasHistorical) state = 'historical';
  else if (hasCurrent) state = 'current';
  else if (decisive) state = 'other';

  const snapshots = [online, daily, gauntlet].filter(Boolean);
  const cachedCompletion = snapshots.some((snap) => (
    (finiteNumber(snap.bestTimeMs) != null && Number(snap.bestTimeMs) > 0 && snap.timeSaved !== false)
    || (finiteNumber(snap.normalPercent) != null && Number(snap.normalPercent) >= 100)
  ));

  return {
    available: maps.available,
    items,
    decisive,
    state,
    historicalReward,
    currentReward,
    online,
    daily,
    gauntlet,
    timelyId,
    cachedCompletion,
  };
}

function rewardEvidenceText(row) {
  const evidence = row.rewardEvidence;
  if (!evidence?.items?.length) return '';
  return evidence.items
    .map((item) => `${item.source}: ${formatNumber(item.value)} (${item.technical})`)
    .join(' · ');
}

function rewardEvidenceMarkup(row) {
  const evidence = row.rewardEvidence;
  if (!evidence?.items?.length) return '';
  const chips = evidence.items.slice(0, 5).map((item) => {
    const decisive = evidence.decisive === item;
    return `<span class="moon-evidence-chip ${decisive ? 'primary' : ''}" title="${escapeHtml(item.technical || '')}">${escapeHtml(item.source)}: <strong>${formatNumber(item.value)}</strong></span>`;
  }).join('');
  return `<div class="moon-evidence-row">${chips}</div>`;
}

function detectionEvidence(row) {
  if (row.specialObtainable) return row.detected ? 'Completed special-case level' : 'Not completed';
  if (!row.detected) {
    if (Array.isArray(row.matchPrefixes) && row.matchPrefixes.includes('d_') && row.markers?.length) {
      return 'Daily marker not found';
    }
    return 'Not detected';
  }
  if (row.confirmedByStoredReward) {
    const d = row.rewardEvidence?.decisive;
    return d ? `Old reward ${formatNumber(d.value)} stored in save` : 'Old reward stored in save';
  }
  if (row.alreadyCurrent) {
    const d = row.rewardEvidence?.decisive;
    return d ? `Current reward ${formatNumber(d.value)} already stored` : 'Current reward already stored';
  }
  if (row.oldRewardRuledOut) return 'Current reward stored; old reward not active';
  if (row.needsReloadStrong) {
    const d = row.rewardEvidence?.decisive;
    return d ? `Old reward ${formatNumber(d.value)} still stored` : 'Old reward still stored';
  }
  if (Array.isArray(row.matchPrefixes) && row.matchPrefixes.includes('d_')) return 'Daily completion found';
  if (row.exactExtra) return 'Completion marker found';
  if (row.markers?.length) return `${row.markers.join(', ')} completion`;
  if (row.cachedCompletion) return 'Cached level data shows a completion';
  if (row.completedCurrent) return 'Current catalog completion';
  return 'Detected';
}

function buildAuditModel(app) {
  const sync = app.state.progress.gdImport;
  if (!sync) return null;

  const sets = completionSets(sync);
  const evidenceMaps = saveEvidenceMaps(sync);
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
  const fixedSourceMoons = detectedFixed.reduce((sum, row) => sum + Number(row.reward || 0), 0);

  const historical = MOON_AUDIT_LEVELS.map((baseRow) => {
    const row = { ...baseRow };
    const markers = markerLabels(row.id, sets);
    const completedCurrent = completedIds.has(String(row.id));
    const strict = strictMarkerDetected(row, sets);
    const rewardEvidence = rewardEvidenceForRow(row, sync);
    const cachedCompletion = Boolean(rewardEvidence.cachedCompletion);
    const detected = strict == null
      ? (markers.length > 0 || completedCurrent || cachedCompletion)
      : strict;

    // A stored historical reward is stronger than a completion marker alone.
    // For rerates it can distinguish a save that still knows the old reward
    // from one that already stores the current reward.
    const confirmedByStoredReward = Boolean(
      detected
      && row.effect === 'extra'
      && rewardEvidence.state === 'historical'
      && rewardEvidence.historicalReward != null
    );
    const oldRewardRuledOut = Boolean(
      detected
      && row.effect === 'extra'
      && row.newReward != null
      && rewardEvidence.state === 'current'
    );
    const needsReloadStrong = Boolean(
      detected
      && row.effect === 'missing'
      && rewardEvidence.state === 'historical'
    );
    const alreadyCurrent = Boolean(
      detected
      && row.effect === 'missing'
      && rewardEvidence.state === 'current'
    );

    return {
      ...row,
      markers,
      completedCurrent,
      detected,
      inCurrentCatalog: Boolean(app.catalog.get(row.id)),
      rewardEvidence,
      cachedCompletion,
      confirmedByStoredReward,
      oldRewardRuledOut,
      needsReloadStrong,
      alreadyCurrent,
      confirmedExtra: Boolean(detected && (row.exactExtra || confirmedByStoredReward)),
    };
  });

  const smallSpace = historical.find((row) => row.specialObtainable) || null;
  const specialOutsideCatalog = historical.filter((row) => row.specialObtainable && row.detected);
  const specialOutsideCatalogMoons = specialOutsideCatalog.reduce((sum, row) => sum + Number(row.delta || 0), 0);

  // Small space is a special obtainable case, not an unobtainable-moon source.
  // If it is already completed, its 3 moons still belong in the proven
  // non-catalog side of the reconciliation. If it is not completed, Moon Check
  // gives the user the special relog instructions instead of counting it.
  const confirmedExtra = historical.filter((row) => row.confirmedExtra && !row.specialObtainable);
  const confirmedExtraMoons = confirmedExtra.reduce((sum, row) => sum + Number(row.delta || 0), 0);

  // Only unresolved cases remain candidates. If the save explicitly stores the
  // current reward for a rerated level, MoonGrinder no longer asks the user to
  // blame that level for an old-reward discrepancy or reload it unnecessarily.
  const extraCandidates = historical.filter((row) => (
    row.effect === 'extra'
    && !row.specialObtainable
    && row.detected
    && !row.confirmedExtra
    && !row.oldRewardRuledOut
  ));
  const reloadCandidates = historical.filter((row) => (
    row.effect === 'missing'
    && row.detected
    && !row.alreadyCurrent
  ));
  const historyCandidates = historical.filter((row) => row.effect === 'history' && row.detected);
  const alreadyCurrentMissing = historical.filter((row) => row.effect === 'missing' && row.detected && row.alreadyCurrent);
  const ruledOutExtra = historical.filter((row) => row.effect === 'extra' && row.detected && row.oldRewardRuledOut);

  const knownNonCatalogMoons = fixedSourceMoons + specialOutsideCatalogMoons + confirmedExtraMoons;
  const nonCatalogBaseline = actualMoons == null ? null : actualMoons - currentCatalogMoons;
  const unexplainedAfterKnown = nonCatalogBaseline == null ? null : nonCatalogBaseline - knownNonCatalogMoons;
  const possibleExtraTotal = extraCandidates.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const possibleMissingTotal = reloadCandidates.reduce((sum, row) => sum + Number(row.delta || 0), 0);

  // Reward increases whose old value is still stored are not merely guesses.
  // The current catalog total uses the new reward, while the imported save is
  // still effectively short by the delta. Apply those stale-reward deltas when
  // reconciling the save total so cases such as forced (8 -> 10) are explained
  // automatically instead of showing a confusing negative unexplained value.
  const confirmedMissingRewards = reloadCandidates.filter((row) => row.needsReloadStrong);
  const confirmedMissingMoons = confirmedMissingRewards.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const reconciledExpectedMoons = actualMoons == null
    ? null
    : currentCatalogMoons - confirmedMissingMoons + knownNonCatalogMoons;
  const finalUnexplained = actualMoons == null ? null : actualMoons - reconciledExpectedMoons;

  // If stored reward evidence is unavailable, an exact negative gap can still
  // be matched against the remaining reload candidates, but those matches are
  // presented as candidates rather than proven adjustments.
  const weakReloadCandidates = reloadCandidates.filter((row) => !row.needsReloadStrong);

  const difficultyCounts = {};
  for (const difficulty of DIFFICULTIES.filter((value) => value !== 'N/A')) difficultyCounts[difficulty] = 0;
  for (const id of completedIds) {
    const level = app.catalog.get(id);
    if (!level) continue;
    const difficulty = String(level.difficulty || 'Unknown');
    difficultyCounts[difficulty] = (difficultyCounts[difficulty] || 0) + 1;
  }

  const evidenceCounts = {
    rewardRegistry: Object.keys(evidenceMaps.rewardByLevel).length,
    timelyRewards: Object.keys(evidenceMaps.timelyRewardById).length,
    onlineSnapshots: Object.keys(evidenceMaps.online).length,
    dailySnapshots: Object.keys(evidenceMaps.daily).length,
    gauntletSnapshots: Object.keys(evidenceMaps.gauntlet).length,
    historicalWithRewardEvidence: historical.filter((row) => row.rewardEvidence?.items?.length).length,
  };

  return {
    sync,
    sets,
    actualMoons,
    currentCatalogMoons,
    fixed,
    detectedFixed,
    fixedSourceMoons,
    smallSpace,
    specialOutsideCatalog,
    specialOutsideCatalogMoons,
    confirmedExtra,
    confirmedExtraMoons,
    knownNonCatalogMoons,
    historical,
    extraCandidates,
    reloadCandidates,
    historyCandidates,
    alreadyCurrentMissing,
    ruledOutExtra,
    nonCatalogBaseline,
    unexplainedAfterKnown,
    confirmedMissingRewards,
    confirmedMissingMoons,
    reconciledExpectedMoons,
    finalUnexplained,
    weakReloadCandidates,
    possibleExtraTotal,
    possibleMissingTotal,
    difficultyCounts,
    deepEvidenceAvailable: evidenceMaps.available,
    evidenceCounts,
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
      <span class="moon-source-status ${row.detected ? 'detected' : ''}" aria-hidden="true"><span>${row.detected ? '✓' : '–'}</span></span>
      <div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.difficulty)} · official Tower level</span></div>
    </div>
    <div class="moon-source-reward">
      <span class="moon-confirmed-amount moon-source-amount-badge">${gdMoonAmount(row.reward)}</span>
      <span>${row.detected ? 'Completed in save' : 'Not completed'}</span>
    </div>
  </article>`).join('');
}

function smallSpaceCompletedRow(row) {
  if (!row?.detected) return '';
  return `<article class="moon-source-row detected">
    <div class="moon-source-main">
      <span class="moon-source-status detected" aria-hidden="true"><span>✓</span></span>
      <div><strong>Small space</strong><span>Special bugged non-catalog platformer</span></div>
    </div>
    <div class="moon-source-reward">
      <span class="moon-confirmed-amount moon-source-amount-badge">${gdMoonAmount(3)}</span>
      <span>Completed in save</span>
    </div>
  </article>`;
}

function smallSpaceAvailableMarkup(row) {
  if (!row || row.detected) return '';
  return `<section class="panel moon-check-section moon-panel-padded">
    <div class="panel-heading-row">
      <div>${sectionHeading('One special 3-moon level is still obtainable', 'Small space is a bugged exception. MoonGrinder only shows this section when your imported save does not contain a completion for it.')}</div>
      <span class="moon-confirmed-amount">${gdMoonAmount(3, { prefix: '+' })}</span>
    </div>
    <div class="moon-answer exact-answer">
      <strong>Small space · ID 87363427</strong>
      <p>Beat the level normally first. Because its rating state is bugged, the 3 moons may not appear immediately. If they do not, save your Geometry Dash account, log out, then log back in and load the account again. The 3 moons will often register after the relog.</p>
      <p>This is the one special obtainable case MoonGrinder treats separately from old unrates and expired rewards.</p>
      <div class="button-row"><button class="button button-primary button-small" type="button" data-copy-moon-id="87363427">Copy ID</button></div>
    </div>
  </section>`;
}

function confirmedExtraCard(row) {
  const evidence = detectionEvidence(row);
  let label = 'Confirmed historical moon source';
  if (row.matchPrefixes?.includes('d_')) label = 'Expired Daily level';
  else if (row.exactExtra) label = 'Deleted rated platformer';
  else if (row.section === 'rerate-down') label = 'Old reward still stored';
  else if (row.section === 'unrate') label = 'Unrated reward still stored';
  else if (row.section === 'glitched') label = 'Stored unusual reward';

  return `<article class="moon-case-card confirmed">
    <div class="moon-case-top">
      <div><span class="moon-case-kicker">${escapeHtml(label)}</span><h3>${escapeHtml(row.name)}</h3><p>ID ${escapeHtml(row.id)}</p></div>
      <span class="moon-confirmed-amount">${gdMoonAmount(row.delta, { prefix: '+' })}</span>
    </div>
    <p class="moon-case-summary">${escapeHtml(row.note || '')}</p>
    <div class="moon-case-meta"><span class="moon-proof-chip">${escapeHtml(evidence)}</span><span>Counted as confirmed unobtainable moons</span></div>
    ${rewardEvidenceMarkup(row)}
    <div class="moon-case-actions"><button class="button button-secondary button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>
  </article>`;
}

function extraCandidateCard(row) {
  const section = MOON_AUDIT_SECTION_LABELS[row.section] || row.section;
  const evidence = detectionEvidence(row);
  return `<article class="moon-case-card extra" data-moon-case data-search="${escapeHtml(`${row.name} ${row.id} ${section} ${row.note || ''} ${rewardEvidenceText(row)}`.toLowerCase())}">
    <div class="moon-case-top">
      <div><span class="moon-case-kicker">${escapeHtml(section)}</span><h3>${escapeHtml(row.name)}</h3><p>ID ${escapeHtml(row.id)}</p></div>
      <span class="moon-card-amount extra">${gdMoonAmount(row.delta, { prefix: '+' })}</span>
    </div>
    <p class="moon-case-summary">${escapeHtml(row.note || 'This level can leave extra moons on older saves.')}</p>
    <div class="moon-case-meta"><span>Evidence: ${escapeHtml(evidence)}</span><span>${escapeHtml(rewardChange(row))}</span></div>
    ${rewardEvidenceMarkup(row)}
    <div class="moon-case-actions"><button class="button button-secondary button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>
  </article>`;
}

function reloadCandidateCard(row) {
  const evidence = detectionEvidence(row);
  const confidence = row.needsReloadStrong ? 'old reward stored' : 'check by reloading';
  const summary = row.needsReloadStrong
    ? `MoonGrinder found the old ${formatNumber(row.oldReward || 0)}-moon reward still stored in your save. Reload this level so Geometry Dash can register the current ${formatNumber(row.newReward || 0)}-moon reward.`
    : 'Reload this level in Geometry Dash. If your save still has the older reward registered, opening or redownloading it can update the stored moon value.';
  return `<article class="moon-case-card missing ${row.needsReloadStrong ? 'strong-evidence' : ''}" data-moon-reload data-search="${escapeHtml(`${row.name} ${row.id} ${row.note || ''} ${rewardEvidenceText(row)}`.toLowerCase())}">
    <div class="moon-case-top">
      <div><span class="moon-case-kicker">Reward increased</span><h3>${escapeHtml(row.name)}</h3><p>ID ${escapeHtml(row.id)}</p></div>
      <span class="moon-card-amount missing">${gdMoonAmount(row.delta, { prefix: '+' })}<small>${escapeHtml(confidence)}</small></span>
    </div>
    <div class="reward-change"><span>${formatNumber(row.oldReward || 0)} moons</span><i></i><strong>${formatNumber(row.newReward || 0)} moons</strong></div>
    <p class="moon-case-summary">${escapeHtml(summary)}</p>
    <div class="moon-case-meta"><span>Evidence: ${escapeHtml(evidence)}</span></div>
    ${rewardEvidenceMarkup(row)}
    <div class="moon-case-actions"><button class="button button-primary button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></div>
  </article>`;
}

function allCaseRow(row) {
  const section = MOON_AUDIT_SECTION_LABELS[row.section] || row.section;
  const status = detectionEvidence(row);
  const statusClass = row.detected ? 'good' : 'muted';
  const rowClass = row.confirmedExtra ? 'moon-row-confirmed' : (row.alreadyCurrent || row.oldRewardRuledOut ? 'moon-row-resolved' : '');
  const evidence = rewardEvidenceText(row);
  return `<tr class="${rowClass}" data-all-moon-row data-search="${escapeHtml(`${row.name} ${row.id} ${section} ${row.note || ''} ${evidence}`.toLowerCase())}" data-effect="${escapeHtml(row.effect)}" data-detected="${row.detected ? '1' : '0'}">
    <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(section)}</small></td>
    <td class="num moon-id-cell">${escapeHtml(row.id)}</td>
    <td class="moon-change-cell">${escapeHtml(rewardChange(row))}</td>
    <td><span class="status-text ${statusClass}">${escapeHtml(status)}</span>${evidence ? `<small class="moon-table-evidence">${escapeHtml(evidence)}</small>` : ''}</td>
    <td class="moon-meaning-cell">${escapeHtml(effectLabel(row))}</td>
    <td class="moon-check-table-note">${escapeHtml(row.note || '')}${row.condition ? `<small>${escapeHtml(row.condition)}</small>` : ''}</td>
    <td class="moon-copy-cell"><button class="button button-ghost button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></td>
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
  const finalGap = model.finalUnexplained;
  if (finalGap == null) return '';

  const strongMissing = model.confirmedMissingRewards || [];
  const strongMissingNames = strongMissing.map((row) => row.name);

  if (finalGap === 0) {
    const adjustments = [];
    if (model.currentCatalogMoons != null) adjustments.push(`<li><span>Current catalog value</span><strong>${formatNumber(model.currentCatalogMoons)}</strong></li>`);
    if (model.confirmedMissingMoons > 0) {
      const detail = strongMissing.length === 1
        ? `${strongMissing[0].name} still stores ${formatNumber(strongMissing[0].oldReward)} instead of ${formatNumber(strongMissing[0].newReward)}`
        : `${strongMissing.length} completed levels still store older lower rewards`;
      adjustments.push(`<li><span>Outdated reward adjustment · ${escapeHtml(detail)}</span><strong>-${formatNumber(model.confirmedMissingMoons)}</strong></li>`);
    }
    if (model.knownNonCatalogMoons > 0) adjustments.push(`<li><span>Proven outside-catalog moons</span><strong>+${formatNumber(model.knownNonCatalogMoons)}</strong></li>`);
    adjustments.push(`<li><span>Matches imported save</span><strong>${formatNumber(model.actualMoons)}</strong></li>`);

    let headline = 'MoonGrinder can account for the entire moon total.';
    let body = 'The current catalog, proven non-catalog sources, and stored reward values reconcile exactly with your imported save.';
    if (strongMissing.length === 1) {
      const row = strongMissing[0];
      headline = `${row.name} explains the entire ${formatNumber(row.delta)}-moon shortfall.`;
      body = `Your save still stores ${formatNumber(row.oldReward)} moons for ${row.name}, while the current level is worth ${formatNumber(row.newReward)}. That ${formatNumber(row.delta)}-moon difference is exactly why the raw comparison looked ${formatNumber(row.delta)} moons too low.`;
    } else if (strongMissing.length > 1) {
      headline = `${strongMissing.length} stale level rewards explain the entire ${formatNumber(model.confirmedMissingMoons)}-moon shortfall.`;
      body = `${strongMissingNames.join(', ')} still store older lower rewards in this save. Together their reward increases exactly reconcile the imported moon total.`;
    }

    return `<div class="moon-answer good-answer"><strong>${escapeHtml(headline)}</strong><p>${escapeHtml(body)}</p><ol class="moon-combination-list moon-reconciliation-list">${adjustments.join('')}</ol></div>`;
  }

  // A positive residual means there are still extra moons not covered by the
  // proven sources. Search only the unresolved extra candidates.
  if (finalGap > 0) {
    const combos = exactExtraCombinations(model.extraCandidates, finalGap);
    if (!combos.length) {
      return `<div class="moon-answer"><strong>${formatNumber(finalGap)} moons are still unexplained.</strong><p>MoonGrinder already applied every proven outside-catalog source and every stored old reward it could verify, but no exact combination of the remaining historical candidates matches this residual.</p></div>`;
    }
    const list = combos.map((combo, index) => {
      const names = combo.map((row) => `${row.name} (+${row.delta})`).join(' + ');
      return `<li><span>#${index + 1}</span><strong>${escapeHtml(names)}</strong></li>`;
    }).join('');
    return `<div class="moon-answer exact-answer"><strong>${formatNumber(combos.length)} exact candidate combination${combos.length === 1 ? '' : 's'} can explain the remaining +${formatNumber(finalGap)} moons.</strong><p>These are not promoted to proven sources because the save does not contain decisive old-reward evidence for them.</p><ol class="moon-combination-list">${list}</ol></div>`;
  }

  // A negative residual means the save has fewer moons than the reconciled
  // current value. Try the weaker reward-increase candidates as an exact match.
  const missing = Math.abs(finalGap);
  const combos = exactExtraCombinations(model.weakReloadCandidates || [], missing);
  if (combos.length) {
    const list = combos.map((combo, index) => {
      const names = combo.map((row) => `${row.name} (+${row.delta} after reload)`).join(' + ');
      return `<li><span>#${index + 1}</span><strong>${escapeHtml(names)}</strong></li>`;
    }).join('');
    return `<div class="moon-answer exact-answer"><strong>The remaining ${formatNumber(missing)}-moon shortfall exactly matches ${combos.length === 1 ? 'this reload candidate' : 'these reload combinations'}.</strong><p>The save does not expose decisive old-reward evidence for ${combos.length === 1 ? 'this match' : 'these matches'}, so MoonGrinder keeps them as candidates rather than calling them proven.</p><ol class="moon-combination-list">${list}</ol></div>`;
  }

  return `<div class="moon-answer"><strong>The save is still ${formatNumber(missing)} moons below the fully reconciled current value.</strong><p>MoonGrinder could not match that shortfall exactly to the remaining known reward increases. The reload list below is still the best set of levels to check.</p></div>`;
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
  const confirmedCards = model.confirmedExtra.length
    ? model.confirmedExtra.map(confirmedExtraCard).join('')
    : emptyState('No confirmed unobtainable-moon sources were found.', 'MoonGrinder did not find the specific save markers required for the expired Daily Level or deleted rated platformers.');
  const extraCards = model.extraCandidates.length
    ? model.extraCandidates.map(extraCandidateCard).join('')
    : emptyState('No additional extra-moon candidates were detected.', 'After the confirmed sources, none of the remaining historical candidates were matched in this save.');
  const reloadCards = model.reloadCandidates.length
    ? model.reloadCandidates.map(reloadCandidateCard).join('')
    : emptyState('No completed reward-increase levels need checking.', 'None of the known rerated-up levels were matched as completed in this save.');

  const allRows = model.historical.map(allCaseRow).join('');
  const fixedRows = fixedSourceRows(model);
  const baselineText = model.nonCatalogBaseline == null ? 'Unavailable' : formatNumber(model.nonCatalogBaseline);
  const unexplainedText = model.finalUnexplained == null ? 'Unavailable' : formatNumber(model.finalUnexplained);
  const staleRewardSummary = model.confirmedMissingRewards.length === 1
    ? `${model.confirmedMissingRewards[0].name} accounts for ${formatNumber(model.confirmedMissingMoons)} missing`
    : model.confirmedMissingRewards.length > 1
      ? `${formatNumber(model.confirmedMissingMoons)} missing from ${formatNumber(model.confirmedMissingRewards.length)} stale rewards`
      : `Raw non-catalog difference: ${baselineText}`;
  const deepEvidenceNotice = model.deepEvidenceAvailable
    ? `<section class="panel moon-save-evidence-status moon-panel-padded"><div><span class="status-pill good">Deep save scan active</span><strong>MoonGrinder is checking stored reward values, not just completion markers.</strong><p>${formatNumber(model.evidenceCounts.historicalWithRewardEvidence)} historical case${model.evidenceCounts.historicalWithRewardEvidence === 1 ? '' : 's'} have reward evidence in this save. Sources checked include the downloaded-level reward registry, Daily reward registry, and cached online/Daily/Gauntlet level data.</p></div></section>`
    : `<section class="panel moon-save-evidence-status warning moon-panel-padded"><div><span class="status-pill warn">Re-import once</span><strong>This sync predates the deep reward scan.</strong><p>Import CCGameManager.dat again with this version. MoonGrinder can now read stored reward values from GS_9, GS_17, GLM_03, GLM_10, and GLM_16, which can confirm or rule out several historical moon cases.</p></div></section>`;

  app.main.innerHTML = `
    <section class="page-intro moon-check-intro">
      <div><span class="eyebrow">Moon Check</span><h1>Explain your moon count.</h1><p>Separate moons MoonGrinder can prove from historical candidates, then get a clean list of completed levels worth reloading for potentially missing moons.</p></div>
      <div class="hero-actions"><label class="button button-secondary file-button">Import newer save<input id="moon-check-new-save" type="file" accept=".dat,application/octet-stream"></label></div>
    </section>

    ${previewMarkup(app)}
    ${deepEvidenceNotice}

    <section class="stat-grid four moon-check-stats">
      ${statCard('Moons in save', model.actualMoons == null ? 'Unavailable' : formatNumber(model.actualMoons), `Last synced ${formatDate(sync.importedAt)}`, 'purple')}
      ${statCard('Current catalog', formatNumber(model.currentCatalogMoons), `${formatNumber(sync.matchedCatalogLevels || 0)} completed rated platformers`, 'green')}
      ${statCard('Proven outside catalog', formatNumber(model.knownNonCatalogMoons), `${formatNumber(fixedDetected)} official + ${formatNumber(model.confirmedExtra.length)} historical${model.specialOutsideCatalog.length ? ' + 1 special' : ''}`, 'cyan')}
      ${statCard('Still unexplained', unexplainedText, staleRewardSummary, model.finalUnexplained !== 0 ? 'orange' : 'blue')}
    </section>

    <section class="panel moon-check-guide moon-panel-padded">
      <div class="moon-guide-copy">
        <span class="eyebrow">What to do</span>
        <h2>Use the page in this order.</h2>
        <p>MoonGrinder first checks completion markers, then looks for the reward values still stored inside your save. That lets it promote some old unrates and rerates to confirmed sources, rule others out, and narrow the reload list.</p>
      </div>
      <div class="moon-guide-steps">
        <div><span>1</span><strong>Proven sources</strong><p>Tower markers, Daily markers, deleted-level completions, and old reward values that are still stored in the save are counted first.</p></div>
        <div><span>2</span><strong>Unresolved extra moons</strong><p>Only cases that are completed but do not have decisive reward evidence remain in the possible-extra list.</p></div>
        <div><span>3</span><strong>Potentially missing moons</strong><p>If the save still stores an older lower reward, the reload list marks that level as a strong reload candidate. Levels already storing the current reward are removed.</p></div>
      </div>
    </section>

    <section class="split-layout moon-check-top-split">
      <article class="panel moon-panel-padded">
        ${sectionHeading('Official non-catalog moons', 'Tower levels are outside the online rated-platformer catalog, but their official completion markers can be checked directly.')}
        <div class="moon-source-list">${fixedRows}${smallSpaceCompletedRow(model.smallSpace)}</div>
        <div class="moon-source-total"><span>${model.specialOutsideCatalog.length ? 'Official + special non-catalog total' : 'Official Tower total detected'}</span><div>${gdMoonAmount(model.fixedSourceMoons + model.specialOutsideCatalogMoons, { small: true })}</div></div>
      </article>
      <article class="panel moon-panel-padded">
        ${sectionHeading('Confirmed unobtainable moons', 'These are genuinely unavailable historical moons backed by a specific Daily/deleted-level marker or by an old reward value MoonGrinder can still read directly from your save.')}
        <div class="moon-case-grid moon-case-grid-single">${confirmedCards}</div>
        <div class="moon-source-total"><span>Confirmed historical total</span><div>${gdMoonAmount(model.confirmedExtraMoons, { small: true })}</div></div>
      </article>
    </section>

    <section class="panel moon-check-answer-panel moon-panel-padded">
      ${sectionHeading('What is still unexplained?', 'MoonGrinder reconciles the current catalog with proven outside-catalog moons and any older lower rewards still stored in your save. If one level explains the gap exactly, it tells you directly.')}
      ${explanationMarkup(model)}
    </section>

    ${smallSpaceAvailableMarkup(model.smallSpace)}

    <section class="panel moon-check-section moon-panel-padded" id="extra-moons">
      <div class="panel-heading-row">
        <div>${sectionHeading('Possible extra or unobtainable moons', 'These levels are present in your save, but the available reward data is not decisive enough to count them as confirmed.')}</div>
        ${model.extraCandidates.length ? `<button class="button button-secondary button-small" id="copy-extra-ids">Copy all IDs</button>` : ''}
      </div>
      <div class="moon-case-grid">${extraCards}</div>
      <p class="moon-section-footnote">MoonGrinder now checks GS_9/GS_17 and cached level reward data before leaving something here. These cases remain possible because there is no decisive stored reward value and CCGameManager.dat still has no per-level completion date.${model.ruledOutExtra.length ? ` ${formatNumber(model.ruledOutExtra.length)} detected old-reward case${model.ruledOutExtra.length === 1 ? ' was' : 's were'} ruled out because the save already stores the current reward.` : ''}</p>
    </section>

    <section class="panel moon-check-section moon-panel-padded" id="reload-moons">
      <div class="panel-heading-row">
        <div>${sectionHeading('Levels to reload for potentially missing moons', 'These completed levels are known to have had their moon reward increased. Open or redownload them in Geometry Dash and watch whether your total changes.')}</div>
        ${model.reloadCandidates.length ? `<button class="button button-primary button-small" id="copy-reload-ids">Copy all IDs</button>` : ''}
      </div>
      <div class="moon-case-grid">${reloadCards}</div>
      ${model.alreadyCurrentMissing.length ? `<div class="moon-answer good-answer moon-answer-compact"><strong>${formatNumber(model.alreadyCurrentMissing.length)} completed reward-increase level${model.alreadyCurrentMissing.length === 1 ? ' is' : 's are'} already up to date.</strong><p>MoonGrinder found the current reward stored in the save, so ${model.alreadyCurrentMissing.length === 1 ? 'it was' : 'they were'} removed from the reload list.</p></div>` : ''}
      <p class="moon-section-footnote">Reload candidates are based on reward increases documented in the ${escapeHtml(MOON_AUDIT_SOURCE_NAME)} spreadsheet, refined with the reward values stored in your save when available.</p>
    </section>

    ${model.historyCandidates.length ? `<section class="panel moon-check-section moon-panel-padded">${sectionHeading('Other detected historical cases', 'These are worth knowing about, but the save does not provide enough evidence to assign a reliable moon delta.')}<div class="moon-history-list">${model.historyCandidates.map((row) => `<article><strong>${escapeHtml(row.name)}</strong><span>ID ${escapeHtml(row.id)}</span><p>${escapeHtml(row.note || '')}</p><button class="button button-ghost button-small" type="button" data-copy-moon-id="${escapeHtml(row.id)}">Copy ID</button></article>`).join('')}</div></section>` : ''}

    <details class="panel moon-check-details moon-panel-padded">
      <summary><span>Completion snapshot</span><small>Completed current platformers by difficulty</small></summary>
      <div class="moon-details-body">
        <p>Calculated by matching your completed online IDs against the current MoonGrinder catalog. This is useful context, but it is not used as proof of a historical moon discrepancy.</p>
        <div class="moon-difficulty-bars">${difficultyBars(model, app)}</div>
      </div>
    </details>

    <section class="panel moon-check-section moon-panel-padded">
      <div class="panel-heading-row">
        <div>${sectionHeading('All known historical cases', `Search every discrepancy entry currently included from the ${escapeHtml(MOON_AUDIT_SOURCE_NAME)} spreadsheet.`)}</div>
        <span id="all-moon-count" class="moon-table-count"></span>
      </div>
      <div class="moon-check-filters">
        <input id="all-moon-search" type="search" placeholder="Search level name or ID">
        <select id="all-moon-filter">
          <option value="all">All cases</option>
          <option value="detected">Detected in this save</option>
          <option value="extra">Extra / unobtainable moons</option>
          <option value="missing">Potential missing moons</option>
          <option value="history">Historical / metadata</option>
        </select>
      </div>
      <div class="moon-check-table-wrap">
        <table class="moon-check-table"><thead><tr><th>Level</th><th>ID</th><th>Change</th><th>Your save</th><th>Meaning</th><th>Notes</th><th></th></tr></thead><tbody>${allRows}</tbody></table>
      </div>
    </section>

    <section class="panel moon-credit-panel moon-panel-padded">
      <strong>Data credit</strong>
      <p>Historical unrates, rerates, glitches, and metadata notes are based on the <strong>${escapeHtml(MOON_AUDIT_SOURCE_NAME)}</strong> spreadsheet. MoonGrinder combines those entries with completion markers and locally stored reward/cache data from your imported save. The file stays in your browser.</p>
    </section>
  `;

  wireCommon(app, model);
}
