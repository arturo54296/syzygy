// Starting list of activities (written once into a new shared space; edit them in the app afterwards).
// place: indoor | outdoor | both · cost: 0 free, 1 €, 2 €€, 3 €€€ · hours: typical length
// weather: needs good weather · booking: needs booking ahead
const A = (emoji, name, place, cost, hours, weather = false, booking = false, note = '') => ({ emoji, name, place, cost, hours, weather, booking, note });

const LIST = [
  A('🦁', 'Zoo', 'outdoor', 2, 4, true),
  A('🏊', 'Swimming pool', 'indoor', 1, 2),
  A('🏚️', 'Bunker with Alice', 'both', 1, 3, false, true, 'Arrange it with Alice first'),
  A('🌲', 'Walk in the forest', 'outdoor', 0, 2, true),
  A('🎨', 'Drawing / painting', 'indoor', 0, 2),
  A('📚', 'Reading and exchanging thoughts', 'both', 0, 2),
  A('🎧', 'Listening to albums together', 'indoor', 0, 1),
  A('🎹', 'Learning FL Studio', 'indoor', 0, 2),
  A('🍳', 'Baking / cooking', 'indoor', 1, 2),
  A('🖼️', 'Art gallery / museum', 'indoor', 1, 2, false, false, 'The one we passed on the way to the concert'),
  A('🛋️', 'Hanging out', 'both', 0, 2),
  A('🎬', 'Movie / cinema', 'indoor', 2, 2.5, false, true),
  A('🥾', 'Hike', 'outdoor', 0, 6, true),
  A('💬', 'Discussion topics', 'both', 0, 1),
  A('🎤', '15-minute presentations', 'indoor', 0, 1),
  A('💃', 'Salsa / bachata', 'indoor', 2, 1.5, false, true),
  A('💆', 'Massage', 'indoor', 0, 1),
  A('🧘', 'Yoga', 'indoor', 0, 1),
  A('🏓', 'Ping pong', 'both', 1, 1),
  A('👗', 'Thrift shopping', 'indoor', 1, 3),
  A('🌹', 'Date', 'both', 2, 3),
  A('🤝', 'Volunteering', 'both', 0, 4, false, true),
  A('💻', 'Working together on Saturdays', 'indoor', 0, 6),
  A('⛸️', 'Ice skating', 'indoor', 2, 2),
  A('🧗', 'Bouldering', 'indoor', 2, 2, false, true),
  A('🎁', 'Gifts', 'both', 1, 2),
  A('👔', 'Styling Arturo', 'indoor', 0, 1.5),
  A('🎭', 'Improv theater', 'indoor', 2, 2, false, true, 'A course, like salsa/bachata'),
  A('🎲', 'Board games', 'indoor', 0, 2),
  A('✍️', 'Creative writing (poems)', 'indoor', 0, 1),
  A('🧶', 'Knitting', 'indoor', 1, 2),
  A('🕹️', 'Retro gaming at an arcade', 'indoor', 2, 2),
  A('🏺', 'Workshop (pottery…)', 'indoor', 3, 3, false, true),
];

// Ideas added after the first version. `since` = SEED_VERSION that introduced them: existing spaces get them once,
// on their next load (if you delete one afterwards it doesn't come back).
const LATER = [
  { since: 2, ...A('🛏️', 'Sleeping together', 'indoor', 0, 12), fixed: { from: '21:00', to: '09:00' } },
];

export const SEED_VERSION = 2;
export const SEED = [...LIST, ...LATER].map((a, i) => ({ id: 'seed' + String(i + 1).padStart(2, '0'), archived: false, since: 1, ...a }));
