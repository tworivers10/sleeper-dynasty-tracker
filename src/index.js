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

  const results = await Promise.all(
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

  return results
    .flat()
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        league_id: LEAGUE_ID
      });
    }

    try {
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
        getJSON(
          `/league/${LEAGUE_ID}/matchups/${week}`
        ),
        getTransactions(week)
      ]);

      return Response.json(
        {
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
        },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60"
          }
        }
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          league_id: LEAGUE_ID,
          error: error.message
        },
        {
          status: 502
        }
      );
    }
  }
};
