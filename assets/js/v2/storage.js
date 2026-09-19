import { DEMON_DIFFICULTIES, STORAGE_KEY } from './constants.js';

export function defaultState() {
  return {
    version: 1,
    settings: {
      startingMoons: 0,
      targetMoons: 1000,
      blockMinutes: 60,
      defaultStrategy: 'efficiency',
      catalogPageSize: 60,
      compactCatalog: false,
      includeDeferredInPlans: true,
      plannerExcludedDifficulties: [],
    },
    progress: {
      completed: {},
      deferred: [],
      excluded: [],
      overrides: {},
      lastCompletionStack: [],
    },
    sessions: [],
    activeSession: null,
    ui: {
      catalogFilters: null,
      plannerFilters: null,
    },
  };
}

function mergeState(saved) {
  const base = defaultState();
  if (!saved || typeof saved !== 'object') return base;
  const merged = {
    ...base,
    ...saved,
    settings: { ...base.settings, ...(saved.settings || {}) },
    progress: { ...base.progress, ...(saved.progress || {}) },
    ui: { ...base.ui, ...(saved.ui || {}) },
    sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    activeSession: saved.activeSession && typeof saved.activeSession === 'object' ? saved.activeSession : null,
  };

  if (!['efficiency', 'shortest'].includes(merged.settings.defaultStrategy)) {
    merged.settings.defaultStrategy = 'efficiency';
  }

  const allowedPlannerExclusions = new Set(DEMON_DIFFICULTIES);
  merged.settings.plannerExcludedDifficulties = Array.isArray(merged.settings.plannerExcludedDifficulties)
    ? [...new Set(merged.settings.plannerExcludedDifficulties.filter((difficulty) => allowedPlannerExclusions.has(difficulty)))]
    : [];
  return merged;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function validateImportedState(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('The selected file is not a MoonGrinder save.');
  if (!candidate.settings || !candidate.progress) throw new Error('The selected file is missing MoonGrinder settings or progress data.');
  return mergeState(candidate);
}
