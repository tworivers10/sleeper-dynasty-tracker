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

const [
  league,
  users,
  rosters,
  tradedPicks,
  nflState
] = await Promise.all([
  getJSON(`/league/${LEAGUE_ID}`),
  getJSON(`/league/${LEAGUE_ID}/users`),
  getJSON(`/league/${LEAGUE_ID}/rosters`),
  getJSON(`/league/${LEAGUE_ID}/traded_picks`),
  getJSON("/state/nfl")
]);

const week = Number(nflState.week || 1);

const [matchups, transactions] = await Promise.all([
  getJSON(`/league/${LEAGUE_ID}/matchups/${week}`),
  getTransactions(week)
]);

const snapshot = {
  generated_at: new Date().toISOString(),
  league_id: LEAGUE_ID,
  current_week: week,
  nfl_state: nflState,
  league,
  users,
  rosters,
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
