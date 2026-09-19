export function sortForStrategy(catalog, levels, strategy, state) {
  if (strategy === 'shortest') return catalog.sort(levels, 'duration', state);
  return catalog.sort(levels, 'efficiency', state);
}

export function plannerPool(catalog, state, filters = {}) {
  const base = catalog.available(state, { includeDeferred: filters.includeDeferred });
  const filtered = catalog.applyFilters(base, filters, state);
  const excludedDifficulties = new Set(state.settings.plannerExcludedDifficulties || []);
  return filtered.filter((level) => (
    !excludedDifficulties.has(level.difficulty)
    && catalog.timeFor(level, state).seconds
  ));
}

export function buildTimeBudgetPlan(catalog, state, minutes, strategy, filters = {}) {
  const budget = Math.max(60, Number(minutes) * 60 || 3600);
  const pool = sortForStrategy(catalog, plannerPool(catalog, state, filters), strategy, state);
  const selected = [];
  let totalSeconds = 0;

  for (const level of pool) {
    const seconds = catalog.timeFor(level, state).seconds;
    if (!seconds) continue;
    if (selected.length && totalSeconds + seconds > budget) continue;
    selected.push(level);
    totalSeconds += seconds;
    if (totalSeconds >= budget) break;
  }

  if (!selected.length && pool.length) {
    selected.push(pool[0]);
    totalSeconds = catalog.timeFor(pool[0], state).seconds || 0;
  }

  return planSummary(catalog, state, selected, {
    kind: 'time',
    strategy,
    targetSeconds: budget,
    exact: false,
  });
}

export function buildBlocks(catalog, state, blockMinutes, strategy = 'shortest', filters = {}) {
  const targetSeconds = Math.max(60, Number(blockMinutes) * 60 || 3600);
  const pool = sortForStrategy(catalog, plannerPool(catalog, state, filters), strategy, state);
  const blocks = [];
  let current = [];
  let currentSeconds = 0;

  for (const level of pool) {
    const seconds = catalog.timeFor(level, state).seconds;
    if (!seconds) continue;
    current.push(level);
    currentSeconds += seconds;
    if (currentSeconds >= targetSeconds) {
      blocks.push(planSummary(catalog, state, current, { kind: 'block', strategy, targetSeconds }));
      current = [];
      currentSeconds = 0;
    }
  }
  if (current.length) blocks.push(planSummary(catalog, state, current, { kind: 'block', strategy, targetSeconds }));
  return blocks;
}

export function buildMoonGoalPlan(catalog, state, moonTarget, filters = {}) {
  const current = catalog.currentMoons(state);
  const target = Math.max(current + 1, Number(moonTarget) || current + 1);
  const need = target - current;
  const pool = plannerPool(catalog, state, filters);
  const maxReward = Math.max(1, ...pool.map((level) => Number(level.moons) || 0));

  if (!pool.length) return planSummary(catalog, state, [], { kind: 'goal', moonTarget: target, exact: false, need });

  if (need <= 2500) {
    const exact = exactMinimumTimeMoonPlan(catalog, state, pool, need, maxReward);
    if (exact.length) {
      return planSummary(catalog, state, exact, { kind: 'goal', moonTarget: target, exact: true, need });
    }
  }

  const ordered = catalog.sort(pool, 'efficiency', state);
  const selected = [];
  let moons = 0;
  for (const level of ordered) {
    selected.push(level);
    moons += Number(level.moons) || 0;
    if (moons >= need) break;
  }
  return planSummary(catalog, state, selected, { kind: 'goal', moonTarget: target, exact: false, need });
}

function exactMinimumTimeMoonPlan(catalog, state, pool, need, maxReward) {
  const cap = need + Math.max(0, maxReward - 1);
  const width = cap + 1;
  const n = pool.length;
  const dp = new Float64Array(width);
  dp.fill(Number.POSITIVE_INFINITY);
  dp[0] = 0;

  const decisions = new Uint8Array(n * width);

  for (let i = 0; i < n; i += 1) {
    const level = pool[i];
    const reward = Math.max(0, Number(level.moons) || 0);
    const seconds = catalog.timeFor(level, state).seconds;
    if (!reward || !seconds) continue;
    const rowOffset = i * width;

    for (let sum = cap - reward; sum >= 0; sum -= 1) {
      const previous = dp[sum];
      if (!Number.isFinite(previous)) continue;
      const next = sum + reward;
      const candidate = previous + seconds;
      if (candidate < dp[next]) {
        dp[next] = candidate;
        decisions[rowOffset + next] = 1;
      }
    }
  }

  let bestSum = -1;
  let bestTime = Number.POSITIVE_INFINITY;
  for (let sum = need; sum <= cap; sum += 1) {
    if (dp[sum] < bestTime) {
      bestTime = dp[sum];
      bestSum = sum;
    }
  }
  if (bestSum < 0) return [];

  const selected = [];
  let sum = bestSum;
  for (let i = n - 1; i >= 0 && sum > 0; i -= 1) {
    const level = pool[i];
    const reward = Math.max(0, Number(level.moons) || 0);
    if (reward && decisions[i * width + sum]) {
      selected.push(level);
      sum -= reward;
    }
  }
  selected.reverse();
  return selected;
}

export function planSummary(catalog, state, levels, meta = {}) {
  const totalSeconds = levels.reduce((sum, level) => sum + (catalog.timeFor(level, state).seconds || 0), 0);
  const totalMoons = levels.reduce((sum, level) => sum + (Number(level.moons) || 0), 0);
  return {
    ...meta,
    levels: [...levels],
    totalSeconds,
    totalMoons,
    rate: totalSeconds ? totalMoons * 60 / totalSeconds : 0,
  };
}
