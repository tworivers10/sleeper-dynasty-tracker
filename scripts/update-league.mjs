const LEAGUE_ID = "1353194300984262656";
const BASE = "https://api.sleeper.app/v1";

async function getJSON(path) {
  const response = await fetch(BASE + path);

  if (!response.ok) {
    throw new Error(`Sleeper API ${response.status}: ${path}`);
  }

  return response.json();
}

async function getTransactions(week) {
  const weeks = Array.from(
    { length: Math.max(1, week) },
    (_, i) => i + 1
  );

  const groups = await Promise.all(
    weeks.map(async (w) => {
      try {
        return await getJSON(
          `/league/${LEAGUE_ID}/transactions/${w}`
        );
      } catch {
        return [];
      }
    })
  );

  return groups
    .flat()
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}

function playerInfo(playerId, players) {
  if (!playerId) return null;

  const player = players[playerId];

  if (!player) {
    return {
      player_id: playerId,
      full_name: null,
      position: null,
      team: null,
      status: null
    };
  }

  return {
    player_id: playerId,
    full_name:
      player.full_name ||
      [player.first_name, player.last_name]
        .filter(Boolean)
        .join(" "),
    position: player.position || null,
    fantasy_positions: player.fantasy_positions || [],
    team: player.team || null,
    status: player.status || null,
    injury_status: player.injury_status || null,
    years_exp: player.years_exp ?? null
  };
}

function expandRoster(roster, players) {
  const starters = new Set(roster.starters || []);
  const taxi = new Set(roster.taxi || []);
  const reserve = new Set(roster.reserve || []);

  const playerIds = Array.from(
    new Set([
      ...(roster.players || []),
      ...(roster.starters || []),
      ...(roster.taxi || []),
      ...(roster.reserve || [])
    ])
  );

  return {
    ...roster,

    player_details: playerIds.map((id) => ({
      ...playerInfo(id, players),
      starter: starters.has(id),
      taxi: taxi.has(id),
      reserve: reserve.has(id)
    })),

    starter_details: (roster.starters || []).map((id) =>
      playerInfo(id, players)
    ),

    bench_details: (roster.players || [])
      .filter(
        (id) =>
          !starters.has(id) &&
          !taxi.has(id) &&
          !reserve.has(id)
      )
      .map((id) => playerInfo(id, players)),

    taxi_details: (roster.taxi || []).map((id) =>
      playerInfo(id, players)
    ),

    reserve_details: (roster.reserve || []).map((id) =>
      playerInfo(id, players)
    )
  };
}

const [
  league,
  users,
  rosters,
  tradedPicks,
  nflState,
  players
] = await Promise.all([
  getJSON(`/league/${LEAGUE_ID}`),
  getJSON(`/league/${LEAGUE_ID}/users`),
  getJSON(`/league/${LEAGUE_ID}/rosters`),
  getJSON(`/league/${LEAGUE_ID}/traded_picks`),
  getJSON("/state/nfl"),
  getJSON("/players/nfl")
]);

const week = Number(nflState.week || 1);

const [matchups, transactions] = await Promise.all([
  getJSON(`/league/${LEAGUE_ID}/matchups/${week}`),
  getTransactions(week)
]);

const expandedRosters = rosters.map((roster) =>
  expandRoster(roster, players)
);

// Keep only players actually relevant to this league.
// This prevents league.json from becoming unnecessarily huge.
const leaguePlayerIds = new Set();

for (const roster of rosters) {
  for (const id of roster.players || []) leaguePlayerIds.add(id);
  for (const id of roster.starters || []) leaguePlayerIds.add(id);
  for (const id of roster.taxi || []) leaguePlayerIds.add(id);
  for (const id of roster.reserve || []) leaguePlayerIds.add(id);
}

for (const transaction of transactions) {
  for (const id of Object.keys(transaction.adds || {})) {
    leaguePlayerIds.add(id);
  }

  for (const id of Object.keys(transaction.drops || {})) {
    leaguePlayerIds.add(id);
  }
}

const playerDirectory = {};

for (const id of leaguePlayerIds) {
  playerDirectory[id] = playerInfo(id, players);
}

const snapshot = {
  generated_at: new Date().toISOString(),
  league_id: LEAGUE_ID,
  current_week: week,
  nfl_state: nflState,
  league,
  users,

  // Original Sleeper roster data
  rosters,

  // Same rosters with readable player information
  rosters_expanded: expandedRosters,

  // Quick player-ID lookup table
  player_directory: playerDirectory,

  traded_picks: tradedPicks,
  current_matchups: matchups,
  transactions
};

const { writeFile } = await import("node:fs/promises");

await writeFile(
  "league.json",
  JSON.stringify(snapshot, null, 2) + "\n"
);

console.log(
  `Updated league.json for Sleeper league ${LEAGUE_ID}`
);

console.log(
  `Resolved ${leaguePlayerIds.size} league player IDs`
);
