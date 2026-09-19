import { DATA_URL, RATING_RANK } from './constants.js';

export async function loadCatalog() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.levels)) throw new Error('Catalog JSON has an invalid shape.');
  return new CatalogModel(data);
}

export class CatalogModel {
  constructor(data) {
    this.data = data;
    this.levels = data.levels;
    this.byId = new Map(this.levels.map((level) => [String(level.level_id), level]));
  }

  get(id) {
    return this.byId.get(String(id));
  }

  status(id, state) {
    const key = String(id);
    if (state.progress.completed[key]) return 'completed';
    if (state.progress.excluded.includes(key)) return 'excluded';
    if (state.progress.deferred.includes(key)) return 'deferred';
    return 'available';
  }

  timeFor(level, state) {
    const id = String(level.level_id);
    const override = Number(state.progress.overrides[id]);
    if (Number.isFinite(override) && override > 0) {
      return { seconds: override, custom: true };
    }

    // schema v2 exposes one public estimate. The legacy friends field is kept
    // as a compatibility fallback until every deployed catalog has been rebuilt.
    const estimate = Number(level.estimated_duration_seconds ?? level.friends_duration_seconds);
    if (Number.isFinite(estimate) && estimate > 0) {
      return { seconds: estimate, custom: false };
    }
    return { seconds: null, custom: false };
  }

  efficiency(level, state) {
    const time = this.timeFor(level, state).seconds;
    if (!time) return null;
    return (Number(level.moons) || 0) * 60 / time;
  }

  currentMoons(state) {
    const earned = Object.keys(state.progress.completed).reduce((sum, id) => {
      const level = this.get(id);
      return sum + (level ? Number(level.moons) || 0 : 0);
    }, 0);
    return Math.max(0, Number(state.settings.startingMoons) || 0) + earned;
  }

  available(state, options = {}) {
    const includeDeferred = options.includeDeferred ?? state.settings.includeDeferredInPlans;
    return this.levels.filter((level) => {
      const status = this.status(level.level_id, state);
      if (status === 'completed' || status === 'excluded') return false;
      if (!includeDeferred && status === 'deferred') return false;
      return true;
    });
  }

  applyFilters(levels, filters = {}, state) {
    const query = String(filters.query || '').trim().toLowerCase();
    const difficulties = new Set(filters.difficulties || []);
    const ratings = new Set(filters.ratings || []);
    const moons = new Set((filters.moons || []).map(Number));
    const statuses = new Set(filters.statuses || []);
    const timedOnly = Boolean(filters.timedOnly);
    const maxDuration = Number(filters.maxDurationSeconds) || 0;

    return levels.filter((level) => {
      if (query) {
        const haystack = `${level.name} ${level.creator} ${level.level_id}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (difficulties.size && !difficulties.has(level.difficulty)) return false;
      if (ratings.size && !ratings.has(level.rating)) return false;
      if (moons.size && !moons.has(Number(level.moons))) return false;
      if (statuses.size && !statuses.has(this.status(level.level_id, state))) return false;
      const time = this.timeFor(level, state);
      if (timedOnly && !time.seconds) return false;
      if (maxDuration && (!time.seconds || time.seconds > maxDuration)) return false;
      return true;
    });
  }

  sort(levels, sortKey, state) {
    const copy = [...levels];
    const time = (level) => this.timeFor(level, state).seconds ?? Number.POSITIVE_INFINITY;
    const efficiency = (level) => this.efficiency(level, state) ?? Number.NEGATIVE_INFINITY;

    switch (sortKey) {
      case 'efficiency':
        copy.sort((a, b) => efficiency(b) - efficiency(a) || time(a) - time(b) || a.name.localeCompare(b.name));
        break;
      case 'moons':
        copy.sort((a, b) => Number(b.moons) - Number(a.moons) || time(a) - time(b));
        break;
      case 'name':
        copy.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'id-new':
        copy.sort((a, b) => Number(b.level_id) - Number(a.level_id));
        break;
      case 'id-old':
        copy.sort((a, b) => Number(a.level_id) - Number(b.level_id));
        break;
      case 'rating':
        copy.sort((a, b) => (RATING_RANK[b.rating] ?? -1) - (RATING_RANK[a.rating] ?? -1) || time(a) - time(b));
        break;
      case 'duration':
      default:
        copy.sort((a, b) => time(a) - time(b) || a.name.localeCompare(b.name));
        break;
    }
    return copy;
  }

  progressSummary(state) {
    const completedIds = Object.keys(state.progress.completed);
    let earnedMoons = 0;
    let actualSeconds = 0;
    for (const id of completedIds) {
      const level = this.get(id);
      if (level) earnedMoons += Number(level.moons) || 0;
      actualSeconds += Number(state.progress.completed[id]?.actualSeconds) || 0;
    }
    return {
      completed: completedIds.length,
      deferred: state.progress.deferred.length,
      excluded: state.progress.excluded.length,
      earnedMoons,
      actualSeconds,
      currentMoons: this.currentMoons(state),
    };
  }
}
