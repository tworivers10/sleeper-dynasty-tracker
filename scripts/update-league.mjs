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

  // Handle NFL team defenses
  if (!player && /^[A-Z]{2,3}$/.test(playerId)) {
    return {
      player_id: playerId,
      full_name: `${playerId} D/ST`,
      position: "DEF",
      fantasy_positions: ["DEF"],
      team: playerId,
      status: "Active",
      injury_status: null,
      years_exp: null
    };
  }

  if (!player) {
    return {
      player_id: playerId,
      full_name: null,
      position: null,
      fantasy_positions: [],
      team: null,
      status: null,
      injury_status: null,
      years_exp: null
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

// --------------------------------------------------
// BUILD SET OF EVERY ROSTERED PLAYER
// --------------------------------------------------

const rosteredPlayerIds = new Set();

for (const roster of rosters) {
  for (const id of roster.players || []) {
    rosteredPlayerIds.add(id);
  }

  for (const id of roster.starters || []) {
    rosteredPlayerIds.add(id);
  }

  for (const id of roster.taxi || []) {
    rosteredPlayerIds.add(id);
  }

  for (const id of roster.reserve || []) {
    rosteredPlayerIds.add(id);
  }
}

// --------------------------------------------------
// BUILD PLAYER DIRECTORY
// --------------------------------------------------

const leaguePlayerIds = new Set(rosteredPlayerIds);

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

// --------------------------------------------------
// BUILD WAIVER WIRE / FREE AGENT POOL
// --------------------------------------------------

const waiverWire = [];

const fantasyPositions = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "K"
]);

for (const [id, player] of Object.entries(players)) {
  if (rosteredPlayerIds.has(id)) continue;

  const position = player.position;

  if (!fantasyPositions.has(position)) continue;

  // Ignore retired/inactive players and players
  // who are not currently associated with an NFL team.
  if (!player.team) continue;

  if (
    player.status === "Inactive" ||
    player.status === "Retired"
  ) {
    continue;
  }

  waiverWire.push({
    player_id: id,

    full_name:
      player.full_name ||
      [player.first_name, player.last_name]
        .filter(Boolean)
        .join(" "),

    position: position,
    fantasy_positions: player.fantasy_positions || [],
    team: player.team || null,
    status: player.status || null,
    injury_status: player.injury_status || null,
    years_exp: player.years_exp ?? null
  });
}

// Add unrostered NFL defenses.
const nflTeams = [
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WAS"
];

for (const team of nflTeams) {
  if (!rosteredPlayerIds.has(team)) {
    waiverWire.push({
      player_id: team,
      full_name: `${team} D/ST`,
      position: "DEF",
      fantasy_positions: ["DEF"],
      team: team,
      status: "Active",
      injury_status: null,
      years_exp: null
    });
  }
}

// Sort waiver players by position, then name.
// Actual fantasy rankings can be applied during analysis.
waiverWire.sort((a, b) => {
  if (a.position !== b.position) {
    return a.position.localeCompare(b.position);
  }

  return (a.full_name || "").localeCompare(
    b.full_name || ""
  );
});

// --------------------------------------------------
// FINAL SNAPSHOT
// --------------------------------------------------

const snapshot = {
  generated_at: new Date().toISOString(),
  league_id: LEAGUE_ID,
  current_week: week,
  nfl_state: nflState,
  league,
  users,

  rosters,

  rosters_expanded: expandedRosters,

  player_directory: playerDirectory,

  // Complete unrostered fantasy-player pool
  waiver_wire: waiverWire,

  waiver_wire_count: waiverWire.length,

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

console.log(
  `Found ${waiverWire.length} available fantasy players`
);