import fs from 'node:fs';
import { CatalogModel } from '../assets/js/v2/catalog.js';
import { DEMON_DIFFICULTIES } from '../assets/js/v2/constants.js';
import { defaultState } from '../assets/js/v2/storage.js';
import { buildBlocks, buildMoonGoalPlan, buildTimeBudgetPlan, plannerPool } from '../assets/js/v2/planner.js';

const source = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const catalog = new CatalogModel(source);
const state = defaultState();

if (catalog.levels.length < 3000) throw new Error(`Expected a full rated platformer catalog, got ${catalog.levels.length}`);
if (catalog.byId.size !== catalog.levels.length) throw new Error('Level IDs are not unique.');

const timed = catalog.levels.filter((level) => catalog.timeFor(level, state).seconds);
if (!timed.length) throw new Error('The catalog has no usable estimated times.');

const quick = buildTimeBudgetPlan(catalog, state, 30, 'efficiency');
if (!quick.levels.length || quick.totalSeconds <= 0 || quick.totalMoons <= 0) {
  throw new Error('Time budget planner returned an empty plan.');
}

const target = buildMoonGoalPlan(catalog, state, 100);
if (!target.levels.length || target.totalMoons < 100) {
  throw new Error('Moon goal planner did not reach the requested target.');
}

const blocks = buildBlocks(catalog, state, 60, 'shortest');
if (!blocks.length || blocks.some((block) => !block.levels.length)) {
  throw new Error('Block builder failed.');
}

// Global demon exclusions must affect planners and block building.
const noDemonsState = defaultState();
noDemonsState.settings.plannerExcludedDifficulties = [...DEMON_DIFFICULTIES];
const noDemonPool = plannerPool(catalog, noDemonsState);
if (noDemonPool.some((level) => DEMON_DIFFICULTIES.includes(level.difficulty))) {
  throw new Error('Planner demon exclusions were not applied.');
}
const noDemonBlocks = buildBlocks(catalog, noDemonsState, 60, 'shortest');
if (noDemonBlocks.some((block) => block.levels.some((level) => DEMON_DIFFICULTIES.includes(level.difficulty)))) {
  throw new Error('Block builder ignored demon exclusions.');
}

// Hard / Harder / Insane can be planned as exact reward splits.
for (const [key, difficulty, moons] of [
  ['Hard|4', 'Hard', 4],
  ['Hard|5', 'Hard', 5],
  ['Harder|6', 'Harder', 6],
  ['Harder|7', 'Harder', 7],
  ['Insane|8', 'Insane', 8],
  ['Insane|9', 'Insane', 9],
]) {
  const pool = plannerPool(catalog, state, { difficultyMoonGroups: [key] });
  if (!pool.length) throw new Error(`Split planner group ${key} is empty.`);
  if (pool.some((level) => level.difficulty !== difficulty || Number(level.moons) !== moons)) {
    throw new Error(`Split planner group ${key} included the wrong levels.`);
  }
}

// The old whole-difficulty option must still work.
const wholeHard = plannerPool(catalog, state, { difficulties: ['Hard'] });
if (!wholeHard.length || wholeHard.some((level) => level.difficulty !== 'Hard')) {
  throw new Error('Whole Hard difficulty filter no longer works.');
}
const hardRewards = new Set(wholeHard.map((level) => Number(level.moons)));
if (!hardRewards.has(4) || !hardRewards.has(5)) {
  throw new Error('Whole Hard filter no longer contains both 4- and 5-moon levels.');
}

const forbidden = ['gjp2', 'password', 'udid', 'uuid', 'account_id', 'username', 'reference_player', 'leaderboard', 'tracked', 'manual_duration_seconds'];
const serialized = JSON.stringify(source).toLowerCase();
for (const key of forbidden) {
  if (serialized.includes(`"${key}"`)) throw new Error(`Public catalog contains forbidden field: ${key}`);
}

console.log(`Catalog levels: ${catalog.levels.length}`);
console.log(`Timed levels: ${timed.length}`);
console.log(`30 minute plan: ${quick.levels.length} levels, ${quick.totalMoons} moons`);
console.log(`100 moon goal: ${target.levels.length} levels, ${target.totalMoons} moons, exact=${target.exact}`);
console.log(`60 minute blocks: ${blocks.length}`);
console.log(`Planner demon exclusions: ${DEMON_DIFFICULTIES.length} tiers tested`);
console.log('Hard/Harder/Insane reward splits: 6 groups tested');
console.log('Smoke test passed.');
