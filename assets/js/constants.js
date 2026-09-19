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
