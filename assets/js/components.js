import { difficultyAsset, difficultyBaseAsset, escapeHtml, formatDuration, formatNumber } from './utils.js';

export function moonReward(moons, extraClass = '') {
  return `<span class="moon-reward ${extraClass}" data-moons="${Number(moons) || 0}"><img src="./assets/images/moon.png" alt="" aria-hidden="true"><span>${formatNumber(moons)}</span></span>`;
}

export function difficultyFace(level, size = 'md') {
  const difficulty = level?.difficulty || 'N/A';
  const rating = level?.rating || 'Rated';
  const source = difficultyAsset(difficulty, rating);
  const fallback = difficultyBaseAsset(difficulty);
  const fallbackHandler = source === fallback ? '' : ` onerror="this.onerror=null;this.src='${fallback}'"`;
  return `<img class="difficulty-face difficulty-face-${size}" src="${source}" alt="${escapeHtml(rating)} ${escapeHtml(difficulty)} difficulty icon"${fallbackHandler}>`;
}


export function ratingBadge(rating) {
  const safe = String(rating || 'Rated');
  return `<span class="rating-badge rating-${safe.toLowerCase()}">${escapeHtml(safe)}</span>`;
}

export function statusBadge(status) {
  if (!status || status === 'available') return '';
  const labels = { completed: 'Completed', deferred: 'Skipped', excluded: 'Excluded' };
  return `<span class="status-badge status-${status}">${labels[status] || escapeHtml(status)}</span>`;
}

export function statCard(label, value, detail = '', tone = '') {
  return `<article class="stat-card ${tone ? `tone-${tone}` : ''}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${value}</div>${detail ? `<div class="stat-detail">${detail}</div>` : ''}</article>`;
}

export function progressBar(value, max, label = '') {
  const denominator = Math.max(1, Number(max) || 1);
  const percent = Math.max(0, Math.min(100, (Number(value) || 0) / denominator * 100));
  return `<div class="progress-block"><div class="progress-track"><div class="progress-fill" style="width:${percent.toFixed(2)}%"></div></div>${label ? `<div class="progress-label">${label}</div>` : ''}</div>`;
}

export function levelRow(catalog, level, state, options = {}) {
  const status = catalog.status(level.level_id, state);
  const efficiency = catalog.efficiency(level, state);
  const time = catalog.timeFor(level, state);
  const showActions = options.actions !== false;
  const actions = showActions ? `
    <div class="level-actions">
      <button class="button button-ghost button-small" data-action="level-detail" data-level-id="${level.level_id}">Details</button>
      <button class="button button-ghost button-small" data-action="toggle-completed" data-level-id="${level.level_id}">${status === 'completed' ? 'Undo complete' : 'Complete'}</button>
    </div>` : '';

  return `<article class="level-row ${showActions ? '' : 'level-row-compact'}" data-level-id="${level.level_id}">
    <button class="level-main-button" data-action="level-detail" data-level-id="${level.level_id}" aria-label="Open ${escapeHtml(level.name)} details">
      ${difficultyFace(level, 'sm')}
      <span class="level-identity"><strong>${escapeHtml(level.name)}</strong><span>by ${escapeHtml(level.creator || 'Unknown creator')} · ID ${escapeHtml(level.level_id)}</span></span>
    </button>
    <div class="level-row-moons">${moonReward(level.moons)}</div>
    <div class="level-row-time"><strong>${formatDuration(time.seconds, { compact: true })}</strong><span>estimated time</span></div>
    <div class="level-row-rate"><strong>${efficiency ? `${formatNumber(efficiency, 2)}/min` : 'Unknown'}</strong><span>moons per minute</span></div>
    <div class="level-row-meta">${ratingBadge(level.rating)}${statusBadge(status)}</div>
    ${actions}
  </article>`;
}

export function levelCard(catalog, level, state) {
  const status = catalog.status(level.level_id, state);
  const efficiency = catalog.efficiency(level, state);
  const time = catalog.timeFor(level, state);
  return `<article class="level-card" data-level-id="${level.level_id}">
    <button class="level-card-open" data-action="level-detail" data-level-id="${level.level_id}">
      <div class="level-card-top">${difficultyFace(level, 'lg')}<div class="level-card-title"><span class="eyebrow">${escapeHtml(level.difficulty || 'N/A')}</span><h3>${escapeHtml(level.name)}</h3><p>by ${escapeHtml(level.creator || 'Unknown creator')}</p></div>${ratingBadge(level.rating)}</div>
      <div class="level-card-stats"><div><span>Reward</span>${moonReward(level.moons)}</div><div><span>Estimated time</span><strong>${formatDuration(time.seconds, { compact: true })}</strong></div><div><span>Efficiency</span><strong>${efficiency ? `${formatNumber(efficiency, 2)}/min` : 'Unknown'}</strong></div></div>
      <div class="level-card-footer"><span>ID ${escapeHtml(level.level_id)}</span>${statusBadge(status)}</div>
    </button>
  </article>`;
}

export function planHeader(plan, title, detail = '') {
  return `<div class="plan-summary">
    <div><span class="eyebrow">${escapeHtml(title)}</span><h2>${formatNumber(plan.levels.length)} levels</h2>${detail ? `<p>${detail}</p>` : ''}</div>
    <div class="plan-metrics"><div><span>Estimated time</span><strong>${formatDuration(plan.totalSeconds)}</strong></div><div><span>Moon reward</span><strong>${formatNumber(plan.totalMoons)}</strong></div><div><span>Efficiency</span><strong>${formatNumber(plan.rate, 2)}/min</strong></div></div>
  </div>`;
}

export function planLevelList(catalog, plan, state) {
  if (!plan?.levels?.length) return emptyState('No levels match these settings.', 'Try changing the filters.');
  return `<div class="plan-level-list">${plan.levels.map((level, index) => {
    const time = catalog.timeFor(level, state);
    return `<div class="plan-level-item"><span class="plan-index">${index + 1}</span>${difficultyFace(level, 'xs')}<button data-action="level-detail" data-level-id="${level.level_id}"><strong>${escapeHtml(level.name)}</strong><span>${escapeHtml(level.creator || 'Unknown creator')}</span></button><span>${moonReward(level.moons)}</span><span class="plan-time">${formatDuration(time.seconds, { compact: true })}</span></div>`;
  }).join('')}</div>`;
}

export function emptyState(title, detail = '') {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div>`;
}

export function sectionHeading(title, detail = '', actionHtml = '') {
  return `<div class="section-heading"><div><h2>${escapeHtml(title)}</h2>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div>${actionHtml}</div>`;
}

export function pillCheckbox(name, value, label, checked = false) {
  return `<label class="filter-pill"><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
}
