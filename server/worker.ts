const FACEIT_API_BASE_URL = "https://open.faceit.com/data/v4";
const GAME_ID = "cs2";
const AVG_SAMPLE_SIZE = 30;
const PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];
const MOSCOW_UTC_OFFSET_HOURS = 3;
const FALLBACK_AVATAR = "https://cdn-frontend.faceit-cdn.net/web/300/src/app/assets/images/no-avatar.jpg";
const CACHE_TTL_MS = 45_000;

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
  elo: number;
  kd: number;
  avg: number;
  avgMatchesCount: number;
  maps: Array<{ map: string; matches: number }>;
  day: WindowStats;
  month: WindowStats;
  total: WindowStats;
};

type ApiStatsResponse = {
  updatedAtIso: string;
  players: PlayerViewModel[];
};

type FaceitPlayer = {
  player_id: string;
  nickname: string;
  avatar?: string;
  faceit_url?: string;
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

async function faceitFetch<T>(path: string, env: Env): Promise<T> {
  const url = `${FACEIT_API_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
    if (!shouldRetry || attempt === 3) {
      throw new Error(`FACEIT API error ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 400));
  }

  throw new Error("FACEIT API is unavailable");
}

function detectWinForPlayer(match: PlayerMatch, playerId: string): boolean | null {
  const direct = parseWinFlag(match.i10 ?? match.stats?.i10);
  if (direct !== null) {
    return direct;
  }

  const winner = match.results?.winner ?? match.winner;
  if (!winner || !match.teams) {
    return null;
  }

  const normalizedWinner = normalizeToken(winner);

  for (const [teamKey, team] of Object.entries(match.teams)) {
    const containsPlayer = team.roster?.some((entry) => entry.player_id === playerId);
    if (!containsPlayer) {
      continue;
    }

    const tokens = new Set([
      normalizeToken(teamKey),
      normalizeToken(team.faction_id),
      normalizeToken(team.team_id),
      normalizeToken(team.name),
    ]);

    if (tokens.has("faction1") || tokens.has("f1") || tokens.has("1")) {
      tokens.add("f1");
      tokens.add("faction1");
      tokens.add("1");
    }
    if (tokens.has("faction2") || tokens.has("f2") || tokens.has("2")) {
      tokens.add("f2");
      tokens.add("faction2");
      tokens.add("2");
    }

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

function extractMapMatches(stats: FaceitPlayerStats): Array<{ map: string; matches: number }> {
  const byMap = new Map<string, number>();

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

    if (!/map/i.test(type) && !/^de_/i.test(label)) {
      continue;
    }

    const normalizedMap = label.replace(/^de_/i, "");
    const mapName = normalizedMap.charAt(0).toUpperCase() + normalizedMap.slice(1);
    byMap.set(mapName, (byMap.get(mapName) ?? 0) + matches);
  }

  return [...byMap.entries()]
    .map(([map, matches]) => ({ map, matches }))
    .sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map));
}

async function fetchAllMatchesForWindow(playerId: string, fromUnix: number, toUnix: number, env: Env): Promise<PlayerMatch[]> {
  const pageLimit = 100;
  const maxMatches = 300;
  let offset = 0;
  const all: PlayerMatch[] = [];

  while (offset < maxMatches) {
    const query = new URLSearchParams({
      game: GAME_ID,
      from: String(fromUnix),
      to: String(toUnix),
      offset: String(offset),
      limit: String(pageLimit),
    });

    const response = await faceitFetch<{ items?: PlayerMatch[] }>(`/players/${playerId}/history?${query.toString()}`, env);
    const items = response.items ?? [];
    all.push(...items);

    if (items.length < pageLimit) {
      break;
    }

    offset += pageLimit;
  }

  return all;
}

async function fetchRecentFinishedMatches(playerId: string, targetCount: number, env: Env): Promise<PlayerMatch[]> {
  const pageLimit = 50;
  const maxMatches = 250;
  let offset = 0;
  const collected: PlayerMatch[] = [];

  while (offset < maxMatches && collected.length < targetCount) {
    const query = new URLSearchParams({
      game: GAME_ID,
      offset: String(offset),
      limit: String(pageLimit),
    });

    const response = await faceitFetch<{ items?: PlayerMatch[] }>(`/players/${playerId}/history?${query.toString()}`, env);
    const items = response.items ?? [];

    if (!items.length) {
      break;
    }

    collected.push(...items.filter(isFinishedMatch));

    if (items.length < pageLimit) {
      break;
    }
    offset += pageLimit;
  }

  return collected
    .sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a))
    .slice(0, targetCount);
}

async function resolveKillsForPlayer(matchId: string, playerId: string, env: Env): Promise<number | null> {
  const matchStats = await faceitFetch<FaceitMatchStats>(`/matches/${matchId}/stats`, env);

  for (const round of matchStats.rounds ?? []) {
    for (const team of round.teams ?? []) {
      const playerStats = team.players?.find((entry) => entry.player_id === playerId)?.player_stats;
      if (!playerStats) {
        continue;
      }

      const kills = parseDecimal(findValueByKey(playerStats, ["Kills", "kills", "K", "k", "Total Kills", "total_kills"]));
      return Number.isFinite(kills) ? kills : null;
    }
  }

  return null;
}

async function calculateLastMatchesAvgKills(playerId: string, env: Env): Promise<{ avg: number; resolvedMatches: number }> {
  const matches = await fetchRecentFinishedMatches(playerId, AVG_SAMPLE_SIZE, env);
  if (!matches.length) {
    return { avg: 0, resolvedMatches: 0 };
  }

  const kills: number[] = [];
  for (const match of matches) {
    if (!match.match_id) {
      continue;
    }
    const value = await resolveKillsForPlayer(match.match_id, playerId, env);
    if (value !== null) {
      kills.push(value);
    }
  }

  if (!kills.length) {
    return { avg: 0, resolvedMatches: 0 };
  }

  const sum = kills.reduce((acc, item) => acc + item, 0);
  return { avg: Math.round(sum / kills.length), resolvedMatches: kills.length };
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
  const player = await faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}`, env);
  const stats = await faceitFetch<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}`, env);

  const nowUnix = Math.floor(Date.now() / 1000);
  const [dayMatches, monthMatches, avgData] = await Promise.all([
    fetchAllMatchesForWindow(player.player_id, startOfTodayUnixMoscow(), nowUnix, env),
    fetchAllMatchesForWindow(player.player_id, startOfMonthUnixMoscow(), nowUnix, env),
    calculateLastMatchesAvgKills(player.player_id, env),
  ]);

  const strictDayMatches = dayMatches.filter(isMatchFromTodayMoscow);
  const [day, month] = await Promise.all([
    summarizeMatches(strictDayMatches, player.player_id),
    summarizeMatches(monthMatches, player.player_id),
  ]);

  const lifetime = stats.lifetime;
  const kd = parseDecimal(findValueByKey(lifetime, ["Average K/D Ratio", "Average KD Ratio", "K/D Ratio", "K/D"]));

  return {
    nickname: player.nickname,
    playerId: player.player_id,
    avatar: player.avatar || FALLBACK_AVATAR,
    faceitUrl: player.faceit_url || `https://www.faceit.com/ru/players/${player.nickname}`,
    elo: parseNumber(player.games?.[GAME_ID]?.faceit_elo),
    kd,
    avg: avgData.avg,
    avgMatchesCount: avgData.resolvedMatches,
    maps: extractMapMatches(stats),
    day,
    month,
    total: extractTotalStats(lifetime),
  };
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

    if (url.pathname !== "/api/stats") {
      return json({ error: "Not Found" }, { status: 404, headers });
    }

    if (!env.FACEIT_API_KEY) {
      return json({ error: "FACEIT_API_KEY is missing" }, { status: 500, headers });
    }

    try {
      if (memoryCache && memoryCache.expiresAt > Date.now()) {
        return json(memoryCache.payload, { headers });
      }

      const players: PlayerViewModel[] = [];
      for (const nickname of PLAYER_NICKNAMES) {
        players.push(await loadPlayerStats(nickname, env));
      }

      const payload: ApiStatsResponse = {
        updatedAtIso: new Date().toISOString(),
        players,
      };

      memoryCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
      };

      return json(payload, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return json({ error: message }, { status: 502, headers });
    }
  },
};