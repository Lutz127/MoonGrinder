export const MOON_AUDIT_SOURCE_NAME = 'Every Moon in Geometry Dash';

export const MOON_AUDIT_LEVELS = [
  { section: 'glitched', name: 'Small space', id: '87363427', delta: 3, effect: 'extra', note: 'Twilight-rated level that can behave as stars or moons depending on save/level state.', condition: 'Unlisted from rated platformer search' },

  { section: 'ephemeral', name: 'Level Devil', id: '134077341', delta: 10, effect: 'history', markerHint: 'daily', note: "April Fools' 2026 daily platformer. Its moons were temporary and the spreadsheet notes that the expired value cannot be removed.", condition: 'Expired' },

  { section: 'unrate', name: 'Hina Misora ASMR', id: '80154512', delta: 4, effect: 'extra', note: 'Temporarily converted to platformer mode near the beginning of 2.2, then reverted.' },
  { section: 'unrate', name: 'Supermode', id: '93958258', delta: 8, effect: 'extra', note: 'Temporarily converted to platformer mode near the beginning of 2.2, then reverted.' },
  { section: 'unrate', name: 'Plassic Trials', id: '128071808', delta: 7, effect: 'extra', note: 'Initially rated as a platformer level, later updated to classic mode.' },
  { section: 'unrate', name: 'Try to die', id: '104710963', delta: 8, effect: 'extra', note: 'Unrated and later deleted after being identified as a copied level.', condition: 'Deleted' },
  { section: 'unrate', name: 'Dynamo', id: '110467524', delta: 7, effect: 'extra', note: 'Copied level that was unrated and later deleted.', condition: 'Deleted' },
  { section: 'unrate', name: 'The Parkour Trials', id: '113849805', delta: 4, effect: 'extra', note: 'Deleted after being identified as a copy of The XCat Trials.', condition: 'Deleted' },
  { section: 'unrate', name: 'The XCat Trials', id: '113828525', delta: 4, effect: 'extra', note: 'Was rated only briefly before being unrated.' },
  { section: 'unrate', name: 'FIRE IN THE HEART', id: '113426030', delta: 5, effect: 'extra', note: 'Unrated after being superseded by FIRE IN THE HOUSE.' },
  { section: 'unrate', name: 'Urban Street', id: '116442635', delta: 5, effect: 'extra', note: 'Unrated after being superseded by Urban street V2; later briefly rerated and unrated again.' },

  { section: 'rerate-down', name: 'The Escape', id: '97880206', oldReward: 5, newReward: 4, delta: 1, effect: 'extra', note: 'Reward decreased from 5 moons to 4.' },
  { section: 'rerate-down', name: 'CELESTEial Mountain', id: '98266404', oldReward: 9, newReward: 8, delta: 1, effect: 'extra', note: 'Reward decreased from 9 moons to 8.' },
  { section: 'rerate-down', name: 'The Basement', id: '98518817', oldReward: 7, newReward: 6, delta: 1, effect: 'extra', note: 'Reward decreased from 7 moons to 6.' },
  { section: 'rerate-down', name: 'Swing', id: '98700833', oldReward: 5, newReward: 4, delta: 1, effect: 'extra', note: 'Reward decreased from 5 moons to 4.' },
  { section: 'rerate-down', name: 'WIPEOUT', id: '102724302', oldReward: 6, newReward: 5, delta: 1, effect: 'extra', note: 'Reward decreased from 6 moons to 5.' },
  { section: 'rerate-down', name: 'gdshot roulette', id: '103232305', oldReward: 7, newReward: 6, delta: 1, effect: 'extra', note: 'Reward decreased from 7 moons to 6.' },
  { section: 'rerate-down', name: 'GPhone Dash', id: '103610406', oldReward: 2, newReward: 1, delta: 1, effect: 'extra', note: 'Reward decreased from 2 moons to 1.' },
  { section: 'rerate-down', name: 'Dashin Geometry', id: '105699469', oldReward: 4, newReward: 2, delta: 2, effect: 'extra', note: 'Reward decreased from 4 moons to 2.' },
  { section: 'rerate-down', name: 'Star Rooms', id: '114370037', oldReward: 8, newReward: 7, delta: 1, effect: 'extra', note: 'Reward decreased from 8 moons to 7.' },
  { section: 'rerate-down', name: 'Get Out', id: '103131926', oldReward: 4, newReward: 3, delta: 1, effect: 'extra', note: 'Reward decreased from 4 moons to 3.' },
  { section: 'rerate-down', name: 'Really Evil Baseball', id: '120604218', oldReward: 8, newReward: 2, delta: 6, effect: 'extra', note: 'Reward decreased from 8 moons to 2, the largest recorded moon rating change in the supplied notes.' },
  { section: 'rerate-down', name: 'Skycog Express', id: '127729004', oldReward: 5, newReward: 4, delta: 1, effect: 'extra', note: 'Reward decreased from 5 moons to 4.' },
  { section: 'rerate-down', name: 'pursuit', id: '136674929', oldReward: 6, newReward: 5, delta: 1, effect: 'extra', note: 'Reward decreased from 6 moons to 5.' },
  { section: 'rerate-down', name: 'jungle temple', id: '135346137', oldReward: 8, newReward: 7, delta: 1, effect: 'extra', note: 'Reward decreased from 8 moons to 7.' },

  { section: 'rerate-up', name: 'The Castle', id: '97842236', oldReward: 5, newReward: 6, delta: 1, effect: 'missing', note: 'Reward increased from 5 moons to 6.' },
  { section: 'rerate-up', name: 'SUPER GD GEM HUNT 64', id: '98076904', oldReward: 7, newReward: 9, delta: 2, effect: 'missing', note: 'Reward increased from 7 moons to 9.' },
  { section: 'rerate-up', name: 'Just That Easy', id: '98081864', oldReward: 8, newReward: 9, delta: 1, effect: 'missing', note: 'Reward increased from 8 moons to 9.' },
  { section: 'rerate-up', name: 'The highest point', id: '98551936', oldReward: 5, newReward: 6, delta: 1, effect: 'missing', note: 'Reward increased from 5 moons to 6.' },
  { section: 'rerate-up', name: 'Quick Escape', id: '99414513', oldReward: 6, newReward: 8, delta: 2, effect: 'missing', note: 'Reward increased from 6 moons to 8.' },
  { section: 'rerate-up', name: 'Ice Climbers', id: '99076862', oldReward: 9, newReward: 10, delta: 1, effect: 'missing', note: 'Reward increased from 9 moons to 10.' },
  { section: 'rerate-up', name: 'forced', id: '108885563', oldReward: 8, newReward: 10, delta: 2, effect: 'missing', note: 'Reward increased from 8 moons to 10.' },
  { section: 'rerate-up', name: 'Change Direction', id: '117591717', oldReward: 5, newReward: 6, delta: 1, effect: 'missing', note: 'Reward increased from 5 moons to 6.' },
  { section: 'rerate-up', name: 'MDK CRITICAL HIT', id: '120597221', oldReward: 5, newReward: 6, delta: 1, effect: 'missing', note: 'Reward increased from 5 moons to 6.' },
  { section: 'rerate-up', name: 'GeoBeats', id: '120317164', oldReward: 9, newReward: 10, delta: 1, effect: 'missing', note: 'Reward increased from 9 moons to 10.' },
  { section: 'rerate-up', name: 'Treasure Tracker', id: '104111942', oldReward: 7, newReward: 8, delta: 1, effect: 'missing', note: 'Reward increased from 7 moons to 8.' },
  { section: 'rerate-up', name: 'PlatformerBasicsPack', id: '99263811', oldReward: 2, newReward: 6, delta: 4, effect: 'missing', note: 'Reward increased from 2 moons to 6.' },
  { section: 'rerate-up', name: 'Cube Circuit', id: '123017914', oldReward: 3, newReward: 4, delta: 1, effect: 'missing', note: 'Reward increased from 3 moons to 4.' },
  { section: 'rerate-up', name: 'Nostalgia', id: '125825824', oldReward: 5, newReward: 6, delta: 1, effect: 'missing', note: 'Reward increased from 5 moons to 6.' },
  { section: 'rerate-up', name: 'Telewarp Dreams', id: '126212984', oldReward: 9, newReward: 10, delta: 1, effect: 'missing', note: 'Reward increased from 9 moons to 10.' },
  { section: 'rerate-up', name: 'Deep Sea Cavern 2', id: '126498710', oldReward: 8, newReward: 10, delta: 2, effect: 'missing', note: 'Reward increased from 8 moons to 10.' },
  { section: 'rerate-up', name: '50 Shadows of Joris', id: '134823048', oldReward: 7, newReward: 8, delta: 1, effect: 'missing', note: 'Reward increased from 7 moons to 8.' },

  { section: 'temporary-classic', name: 'Ancient', id: '97818880', reward: 4, effect: 'history', note: 'Temporarily updated to an empty classic-mode level, later reverted.' },
  { section: 'temporary-classic', name: '15 Trials', id: '98797871', reward: 8, effect: 'history', note: 'Temporarily changed to classic mode for an experiment, later reverted by moderators.' },
  { section: 'temporary-classic', name: 'Lost Warehouse', id: '105261860', reward: 8, effect: 'history', note: 'Temporarily changed into an empty classic level, later reverted.' },
  { section: 'temporary-classic', name: 'IWannaPlatformerList', id: '122391065', reward: 10, effect: 'history', note: 'Hack-updated into a trivially easy classic level and later reverted; the supplied notes mention inconsistent reward/category behavior.' },
  { section: 'temporary-classic', name: 'Orbdancer', id: '111631530', reward: 10, effect: 'history', note: 'Hack-updated and reverted; metadata can make it appear as a classic level and disappear from rated-platformer searches.', condition: 'Unlisted from rated platformer search' },
  { section: 'temporary-classic', name: 'Stone Chamber', id: '102782937', reward: 9, effect: 'history', note: 'Hack-updated and reverted; metadata can make it appear as a classic level and disappear from rated-platformer searches.', condition: 'Unlisted from rated platformer search' },
  { section: 'temporary-classic', name: 'gloop demon', id: '108806542', reward: 10, effect: 'history', note: 'Temporarily changed to classic mode and later reverted after an update-lock incident.' },
];

export const MOON_AUDIT_SECTION_LABELS = {
  glitched: 'Glitched / unusual moons',
  ephemeral: 'Temporary / expired moons',
  unrate: 'Formerly rated / now unrated',
  'rerate-down': 'Reward decreased',
  'rerate-up': 'Reward increased',
  'temporary-classic': 'Temporary classic-mode / metadata oddities',
};

// Known moon-bearing platformer levels that are not part of the online rated
// platformer catalog. These are useful for explaining the non-catalog portion
// of a player's moon count after importing CCGameManager.dat.
export const MOON_FIXED_NONCATALOG_LEVELS = [
  { name: 'The Tower', id: '5001', reward: 5, difficulty: 'Normal', kind: 'Official Tower', markerPrefixes: ['n_', 'c_'] },
  { name: 'The Sewers', id: '5002', reward: 6, difficulty: 'Hard', kind: 'Official Tower', markerPrefixes: ['n_', 'c_'] },
  { name: 'The Cellar', id: '5003', reward: 7, difficulty: 'Harder', kind: 'Official Tower', markerPrefixes: ['n_', 'c_'] },
  { name: 'The Secret Hollow', id: '5004', reward: 7, difficulty: 'Harder', kind: 'Official Tower', markerPrefixes: ['n_', 'c_'] },
];
