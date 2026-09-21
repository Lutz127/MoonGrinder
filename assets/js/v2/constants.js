export const DATA_URL = './data/catalog.json';
export const STORAGE_KEY = 'moongrinder.web.state.v1';

export const DIFFICULTIES = [
  'Auto',
  'Easy',
  'Normal',
  'Hard',
  'Harder',
  'Insane',
  'Easy Demon',
  'Medium Demon',
  'Hard Demon',
  'Insane Demon',
  'Extreme Demon',
  'N/A',
];

export const RATINGS = ['Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'];

export const DEMON_DIFFICULTIES = [
  'Easy Demon',
  'Medium Demon',
  'Hard Demon',
  'Insane Demon',
  'Extreme Demon',
];

export const PLANNER_DIFFICULTY_MOON_GROUPS = [
  { key: 'Hard|4', difficulty: 'Hard', moons: 4, label: 'Hard · 4 moons' },
  { key: 'Hard|5', difficulty: 'Hard', moons: 5, label: 'Hard · 5 moons' },
  { key: 'Harder|6', difficulty: 'Harder', moons: 6, label: 'Harder · 6 moons' },
  { key: 'Harder|7', difficulty: 'Harder', moons: 7, label: 'Harder · 7 moons' },
  { key: 'Insane|8', difficulty: 'Insane', moons: 8, label: 'Insane · 8 moons' },
  { key: 'Insane|9', difficulty: 'Insane', moons: 9, label: 'Insane · 9 moons' },
];

export const RATING_RANK = Object.fromEntries(RATINGS.map((rating, index) => [rating, index]));

export const DIFFICULTY_SLUGS = {
  Auto: 'auto',
  Easy: 'easy',
  Normal: 'normal',
  Hard: 'hard',
  Harder: 'harder',
  Insane: 'insane',
  'Easy Demon': 'easy_demon',
  'Medium Demon': 'medium_demon',
  'Hard Demon': 'hard_demon',
  'Insane Demon': 'insane_demon',
  'Extreme Demon': 'extreme_demon',
  'N/A': 'na',
};

export const ROUTES = [
  ['overview', 'Overview'],
  ['planner', 'Planner'],
  ['catalog', 'Catalog'],
  ['grind', 'Grind'],
  ['gd-lists', 'GD Lists'],
  ['progress', 'Progress'],
  ['moon-check', 'Moon Check'],
  ['stats', 'Stats'],
  ['settings', 'Settings'],
  ['about', 'About'],
];

export const STRATEGIES = {
  efficiency: 'Most efficient',
  shortest: 'Shortest first',
};
