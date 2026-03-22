const FACEIT_API_BASE_URL = "https://open.faceit.com/data/v4";
const GAME_ID = "cs2";
const AVG_SAMPLE_SIZE = 30;
const PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];
const MOSCOW_UTC_OFFSET_HOURS = 3;
const FALLBACK_AVATAR = "https://cdn-frontend.faceit-cdn.net/web/300/src/app/assets/images/no-avatar.jpg";
const CACHE_TTL_MS = 300_000;
const HISTORY_LIMIT = 100;
const PLAYER_CACHE_TTL_MS = 120_000;

type WindowStats = {
  matches: number;
  wins: number;
  losses: number;
};

type PlayerViewModel = {
  nickname: string;
  playerId: string;
  avatar: string;
  faceitUrl: string;
  hasPremium: boolean;
  elo: number;
  kd: number;
  avg: number;
  avgMatchesCount: number;
  maps: Array<{ map: string; matches: number; winRate: number }>;
  day: WindowStats;
  month: WindowStats;
  total: WindowStats;
};

type ApiStatsResponse = {
  updatedAtIso: string;
  players: PlayerViewModel[];
  error?: string;
};

type PlayerApiResponse = {
  updatedAtIso: string;
  player: PlayerViewModel | null;
  error?: string;
};

type FaceitPlayer = {
  player_id: string;
  nickname: string;
  avatar?: string;
  faceit_url?: string;
  membership_type?: string;
  memberships?: unknown;
  premium?: boolean;
  has_premium?: boolean;
  subscription_type?: string;
  subscriptions?: unknown;
  games?: {
    [key: string]: {
      faceit_elo?: number;
    };
  };
};

type FaceitPlayerStats = {
  lifetime?: Record<string, unknown>;
  segments?: Array<{
    type?: string;
    label?: string;
    mode?: string;
    stats?: Record<string, unknown>;
  }>;
};

type PlayerMatch = {
  match_id?: string;
  finished_at?: number;
  started_at?: number;
  status?: string;
  teams?: Record<string, { faction_id?: string; team_id?: string; name?: string; roster?: Array<{ player_id?: string }> }>;
  results?: {
    winner?: string;
  };
  winner?: string;
  i10?: string;
  stats?: {
    i10?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type FaceitMatchStats = {
  rounds?: Array<{
    teams?: Array<{
      players?: Array<{
        player_id?: string;
        player_stats?: Record<string, unknown>;
      }>;
    }>;
  }>;
};

type Env = {
  FACEIT_API_KEY: string;
  ALLOWED_ORIGINS?: string;
};

let memoryCache: { expiresAt: number; payload: ApiStatsResponse } | null = null;
let lastSuccessfulPayload: ApiStatsResponse | null = null;
const playerMemoryCache = new Map<string, { expiresAt: number; payload: PlayerViewModel }>();

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseDecimal(value: unknown): number {
  const str = String(value ?? "").trim();
  const match = str.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }

  const parsed = parseDecimal(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  // FACEIT may return win rate as 0.56 (ratio) or 56 / "56%" (percent).
  if (!raw.includes("%") && parsed > 0 && parsed <= 1) {
    return parsed * 100;
  }

  return parsed;
}

function parseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWinFlag(value: unknown): boolean | null {
  const token = normalizeToken(value);
  if (["1", "true", "win", "won"].includes(token)) {
    return true;
  }
  if (["0", "false", "loss", "lose", "lost"].includes(token)) {
    return false;
  }
  return null;
}

function detectPremium(player: FaceitPlayer): boolean {
  if (typeof player.premium === "boolean") {
    return player.premium;
  }

  if (typeof player.has_premium === "boolean") {
    return player.has_premium;
  }

  const directTokens = [player.membership_type, player.subscription_type].map((entry) => normalizeToken(entry));
  if (directTokens.some((token) => token.includes("premium"))) {
    return true;
  }

  const collections = [player.memberships, player.subscriptions];
  for (const value of collections) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const token = normalizeToken(item);
        if (token.includes("premium")) {
          return true;
        }
      }
    }

    if (value && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        const token = normalizeToken(nested);
        if (token.includes("premium")) {
          return true;
        }
      }
    }
  }

  return false;
}

function pickExistingValue(record: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  const normalized = new Set(keys.map((key) => normalizeToken(key)));
  for (const [key, value] of Object.entries(record)) {
    if (normalized.has(normalizeToken(key))) {
      return value;
    }
  }

  return undefined;
}

function findValueByKey(record: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  const normalized = new Set(keys.map((key) => normalizeToken(key)));
  for (const [key, value] of Object.entries(record)) {
    if (normalized.has(normalizeToken(key))) {
      return value;
    }
  }

  return undefined;
}

function normalizeFactionToken(value: unknown): string {
  const token = normalizeToken(value);
  if (!token) {
    return "";
  }
  if (token === "1" || token === "f1" || token === "faction1") {
    return "f1";
  }
  if (token === "2" || token === "f2" || token === "faction2") {
    return "f2";
  }
  return token;
}

function getMoscowNow(): Date {
  return new Date(Date.now() + MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

function moscowDateToUnix(year: number, monthIndex: number, day: number): number {
  const utcMs = Date.UTC(year, monthIndex, day, 0, 0, 0) - MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  return Math.floor(utcMs / 1000);
}

function startOfTodayUnixMoscow(): number {
  const now = getMoscowNow();
  return moscowDateToUnix(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfTomorrowUnixMoscow(): number {
  const now = getMoscowNow();
  return moscowDateToUnix(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function startOfMonthUnixMoscow(): number {
  const now = getMoscowNow();
  return moscowDateToUnix(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function getMatchTimestamp(match: PlayerMatch): number {
  return parseNumber(match.finished_at ?? match.started_at);
}

function isMatchFromTodayMoscow(match: PlayerMatch): boolean {
  const timestamp = getMatchTimestamp(match);
  if (!timestamp) {
    return false;
  }

  return timestamp >= startOfTodayUnixMoscow() && timestamp < startOfTomorrowUnixMoscow();
}

function isFinishedMatch(match: PlayerMatch): boolean {
  const status = normalizeToken(match.status);
  if (status) {
    return status === "finished";
  }
  return Boolean(match.finished_at);
}

async function faceitFetch<T>(path: string, env: Env, retries = 2): Promise<T> {
  const url = `${FACEIT_API_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.FACEIT_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt === retries) {
      throw new Error(`FACEIT API error ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 400));
  }

  throw new Error("FACEIT API is unavailable");
}

function detectWinForPlayer(match: PlayerMatch, playerId: string): boolean | null {
  const direct = parseWinFlag(
    match.i10 ??
      pickExistingValue(match.stats as Record<string, unknown> | undefined, [
        "i10",
        "result",
        "Result",
        "win",
        "Win",
        "won",
        "Won",
        "is_winner",
      ]),
  );
  if (direct !== null) {
    return direct;
  }

  const winner = normalizeFactionToken(
    match.results?.winner ??
      match.winner ??
      pickExistingValue(match.stats as Record<string, unknown> | undefined, ["winner", "Winner", "winning_team", "winning faction"]),
  );
  if (!winner || !match.teams) {
    return null;
  }

  const normalizedWinner = winner;

  // Some history payloads expose player's faction directly without full roster.
  const directFaction = normalizeFactionToken(
    match.faction ??
      match.team ??
      pickExistingValue(match.stats as Record<string, unknown> | undefined, ["faction", "team", "player_faction", "i1"]),
  );
  if (directFaction) {
    return directFaction === normalizedWinner;
  }

  for (const [teamKey, team] of Object.entries(match.teams)) {
    const rosterEntries = Array.isArray(team.roster) ? team.roster : [];
    const dynamicPlayers = Array.isArray((team as { players?: unknown[] }).players) ? ((team as { players?: Array<Record<string, unknown>> }).players ?? []) : [];
    const containsPlayer =
      rosterEntries.some((entry) => entry.player_id === playerId) ||
      dynamicPlayers.some((entry) => {
        const pid = String(entry.player_id ?? entry.playerId ?? "");
        return pid === playerId;
      });
    if (!containsPlayer) {
      continue;
    }

    const tokens = new Set([
      normalizeFactionToken(teamKey),
      normalizeFactionToken(team.faction_id),
      normalizeFactionToken(team.team_id),
      normalizeToken(team.name),
    ]);

    return tokens.has(normalizedWinner);
  }

  return null;
}

async function summarizeMatches(matches: PlayerMatch[], playerId: string): Promise<WindowStats> {
  const completed = matches.filter(isFinishedMatch);
  let wins = 0;
  let losses = 0;

  for (const match of completed) {
    const win = detectWinForPlayer(match, playerId);
    if (win === true) {
      wins += 1;
    } else if (win === false) {
      losses += 1;
    }
  }

  return { matches: completed.length, wins, losses };
}

function extractMapMatches(stats: FaceitPlayerStats): Array<{ map: string; matches: number; winRate: number }> {
  const byMap = new Map<string, { matches: number; weightedWinRate: number }>();

  for (const segment of stats.segments ?? []) {
    const label = (segment.label ?? "").trim();
    const type = (segment.type ?? "").trim();
    if (!label || /^overall$/i.test(label)) {
      continue;
    }

    const matches = parseNumber(segment.stats?.Matches ?? segment.stats?.matches);
    if (matches <= 0) {
      continue;
    }

    const directWinRate = parsePercent(
      findValueByKey(segment.stats, ["Win Rate %", "Win Rate", "Winrate", "win_rate", "win_rate_pct", "win_rate_percent"]),
    );
    const wins = parseNumber(findValueByKey(segment.stats, ["Wins", "wins"]));
    const computedWinRate = matches > 0 ? (wins / matches) * 100 : 0;
    const winRateRaw = directWinRate > 0 ? directWinRate : computedWinRate;
    const winRate = Math.max(0, Math.min(100, winRateRaw));

    if (!/map/i.test(type) && !/^de_/i.test(label)) {
      continue;
    }

    const normalizedMap = label.replace(/^de_/i, "");
    const mapName = normalizedMap.charAt(0).toUpperCase() + normalizedMap.slice(1);
    const prev = byMap.get(mapName);
    if (!prev) {
      byMap.set(mapName, { matches, weightedWinRate: winRate * matches });
      continue;
    }

    byMap.set(mapName, {
      matches: prev.matches + matches,
      weightedWinRate: prev.weightedWinRate + winRate * matches,
    });
  }

  return [...byMap.entries()]
    .map(([map, value]) => ({
      map,
      matches: value.matches,
      winRate: Number(((value.weightedWinRate || 0) / Math.max(value.matches, 1)).toFixed(1)),
    }))
    .sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map));
}

async function fetchRecentHistory(playerId: string, env: Env): Promise<PlayerMatch[]> {
  const query = new URLSearchParams({
    game: GAME_ID,
    offset: "0",
    limit: String(HISTORY_LIMIT),
  });

  const response = await faceitFetch<{ items?: PlayerMatch[] }>(`/players/${playerId}/history?${query.toString()}`, env);
  return response.items ?? [];
}

async function fetchMatchStats(matchId: string, env: Env): Promise<FaceitMatchStats | null> {
  if (!matchId) {
    return null;
  }

  try {
    return await faceitFetch<FaceitMatchStats>(`/matches/${matchId}/stats`, env, 1);
  } catch {
    return null;
  }
}

function extractKillsFromMatchStats(matchStats: FaceitMatchStats | null, playerId: string): number | null {
  if (!matchStats?.rounds?.length) {
    return null;
  }

  for (const round of matchStats.rounds) {
    for (const team of round.teams ?? []) {
      for (const player of team.players ?? []) {
        if (player.player_id !== playerId) {
          continue;
        }

        const rawKills = findValueByKey(player.player_stats, ["Kills", "kills", "K", "Total Kills", "total_kills", "i6"]);
        const parsed = parseDecimal(rawKills);
        return parsed > 0 || String(rawKills ?? "").trim() === "0" ? parsed : null;
      }
    }
  }

  return null;
}

function resolveKillsFromHistory(match: PlayerMatch): number | null {
  const source = match.stats as Record<string, unknown> | undefined;
  if (!source) {
    return null;
  }

  const rawKills = pickExistingValue(source, ["Kills", "kills", "K", "k", "Total Kills", "total_kills", "i6"]);
  if (rawKills === undefined || rawKills === null || rawKills === "") {
    return null;
  }

  const kills = parseDecimal(rawKills);
  return Number.isFinite(kills) ? kills : null;
}

async function calculateLastMatchesAvgKills(
  playerId: string,
  history: PlayerMatch[],
  env: Env,
  lifetime: Record<string, unknown> | undefined,
): Promise<{ avg: number; resolvedMatches: number }> {
  const matches = history
    .filter(isFinishedMatch)
    .sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a))
    .slice(0, AVG_SAMPLE_SIZE);

  if (!matches.length) {
    return { avg: 0, resolvedMatches: 0 };
  }

  const kills: number[] = [];
  for (const match of matches) {
    const matchId = String(match.match_id ?? "");
    if (!matchId) {
      continue;
    }

    const matchStats = await fetchMatchStats(matchId, env);
    const fromMatchStats = extractKillsFromMatchStats(matchStats, playerId);
    if (fromMatchStats !== null) {
      kills.push(fromMatchStats);
      continue;
    }

    const fromHistory = resolveKillsFromHistory(match);
    if (fromHistory !== null) {
      kills.push(fromHistory);
    }
  }

  if (kills.length) {
    const sum = kills.reduce((acc, item) => acc + item, 0);
    return { avg: Math.round(sum / kills.length), resolvedMatches: kills.length };
  }

  // Fallback to profile metric only when match-level kills are missing.
  const lifetimeAvg = parseDecimal(
    findValueByKey(lifetime, ["Average Kills", "Average Kills per Match", "Avg Kills", "average_kills", "avg_kills"]),
  );
  if (lifetimeAvg > 0) {
    return { avg: Math.round(lifetimeAvg), resolvedMatches: 0 };
  }

  return { avg: 0, resolvedMatches: 0 };
}

function extractTotalStats(lifetime: Record<string, unknown> | undefined): WindowStats {
  const matches = parseNumber(lifetime?.Matches ?? lifetime?.matches);
  const wins = parseNumber(lifetime?.Wins ?? lifetime?.wins);
  return {
    matches,
    wins,
    losses: Math.max(matches - wins, 0),
  };
}

async function loadPlayerStats(nickname: string, env: Env): Promise<PlayerViewModel> {
  const cached = playerMemoryCache.get(nickname.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const player = await faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}`, env);
  const stats = await faceitFetch<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}`, env);

  const history = await fetchRecentHistory(player.player_id, env);

  const daySource = history.filter(isMatchFromTodayMoscow);
  const monthSource = history.filter((match) => getMatchTimestamp(match) >= startOfMonthUnixMoscow());
  const lifetime = stats.lifetime;

  const [day, month, avgData] = await Promise.all([
    summarizeMatches(daySource, player.player_id),
    summarizeMatches(monthSource, player.player_id),
    calculateLastMatchesAvgKills(player.player_id, history, env, lifetime),
  ]);

  const kd = parseDecimal(findValueByKey(lifetime, ["Average K/D Ratio", "Average KD Ratio", "K/D Ratio", "K/D"]));

  const payload: PlayerViewModel = {
    nickname: player.nickname,
    playerId: player.player_id,
    avatar: player.avatar || FALLBACK_AVATAR,
    faceitUrl: player.faceit_url || `https://www.faceit.com/ru/players/${player.nickname}`,
    hasPremium: detectPremium(player),
    elo: parseNumber(player.games?.[GAME_ID]?.faceit_elo),
    kd,
    avg: avgData.avg,
    avgMatchesCount: avgData.resolvedMatches,
    maps: extractMapMatches(stats),
    day,
    month,
    total: extractTotalStats(lifetime),
  };

  playerMemoryCache.set(nickname.toLowerCase(), {
    expiresAt: Date.now() + PLAYER_CACHE_TTL_MS,
    payload,
  });

  return payload;
}

function pickCorsOrigin(request: Request, env: Env): string {
  const requestOrigin = request.headers.get("origin") ?? "";
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const fallbackAllowed = ["https://youngmaze.github.io", "http://localhost:5173", "http://127.0.0.1:5173"];
  const allowedOrigins = configured.length ? configured : fallbackAllowed;

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] ?? "*";
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  return {
    "access-control-allow-origin": pickCorsOrigin(request, env),
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, { headers });
    }

    if (url.pathname !== "/api/stats" && url.pathname !== "/api/player-stats") {
      return json({ error: "Not Found" }, { status: 404, headers });
    }

    if (!env.FACEIT_API_KEY) {
      return json({ error: "FACEIT_API_KEY is missing" }, { status: 500, headers });
    }

    try {
      if (url.pathname === "/api/player-stats") {
        const nickname = (url.searchParams.get("nickname") ?? "").trim();
        if (!nickname) {
          return json({ error: "nickname is required" }, { status: 400, headers });
        }

        try {
          const player = await loadPlayerStats(nickname, env);
          const payload: PlayerApiResponse = {
            updatedAtIso: new Date().toISOString(),
            player,
          };
          return json(payload, { headers });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown server error";
          const payload: PlayerApiResponse = {
            updatedAtIso: new Date().toISOString(),
            player: null,
            error: message,
          };
          return json(payload, { status: 200, headers });
        }
      }

      if (memoryCache && memoryCache.expiresAt > Date.now()) {
        return json(memoryCache.payload, { headers });
      }

      const settled = await Promise.allSettled(PLAYER_NICKNAMES.map((nickname) => loadPlayerStats(nickname, env)));
      const players = settled
        .filter((item): item is PromiseFulfilledResult<PlayerViewModel> => item.status === "fulfilled")
        .map((item) => item.value);

      if (!players.length) {
        const fallbackPayload: ApiStatsResponse = lastSuccessfulPayload ?? {
          updatedAtIso: new Date().toISOString(),
          players: [],
          error: "FACEIT API временно не вернул данные по игрокам",
        };

        return json(fallbackPayload, {
          status: 200,
          headers: {
            ...headers,
            "x-retard-stats-stale": "1",
            "x-retard-stats-error": "FACEIT API временно не вернул данные по игрокам",
          },
        });
      }

      const payload: ApiStatsResponse = {
        updatedAtIso: new Date().toISOString(),
        players,
      };

      memoryCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
      };
      lastSuccessfulPayload = payload;

      return json(payload, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      if (lastSuccessfulPayload) {
        return json(lastSuccessfulPayload, {
          status: 200,
          headers: {
            ...headers,
            "x-retard-stats-stale": "1",
            "x-retard-stats-error": message,
          },
        });
      }

      return json(
        {
          updatedAtIso: new Date().toISOString(),
          players: [],
          error: message,
        },
        {
          status: 200,
          headers: {
            ...headers,
            "x-retard-stats-stale": "1",
            "x-retard-stats-error": message,
          },
        },
      );
    }
  },
};