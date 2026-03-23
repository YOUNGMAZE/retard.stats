const FACEIT_API_BASE_URL = "https://open.faceit.com/data/v4";
const GAME_ID = "cs2";
const AVG_SAMPLE_SIZE = 30;
const HISTORY_LIMIT = 100;
const CACHE_TTL_MS = 300_000;
const PLAYER_CACHE_TTL_MS = 120_000;
const DEFAULT_PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];
const MOSCOW_UTC_OFFSET_HOURS = 3;
const FALLBACK_AVATAR = "https://cdn-frontend.faceit-cdn.net/web/300/src/app/assets/images/no-avatar.jpg";

type WindowStats = {
  matches: number;
  wins: number;
  losses: number;
};

type MapStats = {
  map: string;
  matches: number;
  winRate: number;
  wins: number;
  losses: number;
  kd: number;
  avgKills: number;
};

type ActivityInfo = {
  inMatch: boolean;
  matchId?: string;
  matchUrl?: string;
};

type LastMatchInfo = {
  matchId: string;
  matchUrl: string;
  playedAtIso: string;
  map: string;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
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
  maps: MapStats[];
  day: WindowStats;
  month: WindowStats;
  total: WindowStats;
  activity: ActivityInfo;
  lastMatch: LastMatchInfo | null;
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

type SearchApiResponse = {
  items: Array<{ nickname: string; avatar: string; elo: number }>;
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
  teams?: Record<string, { faction_id?: string; team_id?: string; name?: string; roster?: Array<{ player_id?: string }>; players?: Array<Record<string, unknown>> }>;
  results?: {
    winner?: string;
  };
  winner?: string;
  faction?: string;
  team?: string;
  i10?: string;
  stats?: Record<string, unknown>;
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

type FaceitSearchResponse = {
  items?: Array<{
    nickname?: string;
    avatar?: string;
    games?: {
      [key: string]: {
        faceit_elo?: number;
      };
    };
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

function normalizeMapName(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "Unknown";
  }
  const withoutPrefix = raw.replace(/^de_/i, "").replace(/^cs_/i, "");
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
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

function parsePercent(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }

  const parsed = parseDecimal(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  if (!raw.includes("%") && parsed > 0 && parsed <= 1) {
    return parsed * 100;
  }

  return parsed;
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
  return pickExistingValue(record, keys);
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
        if (normalizeToken(item).includes("premium")) {
          return true;
        }
      }
    }

    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        if (normalizeToken(item).includes("premium")) {
          return true;
        }
      }
    }
  }

  return false;
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
      pickExistingValue(match.stats, ["i10", "result", "Result", "win", "Win", "won", "Won", "is_winner"]),
  );
  if (direct !== null) {
    return direct;
  }

  const winner = normalizeFactionToken(
    match.results?.winner ??
      match.winner ??
      pickExistingValue(match.stats, ["winner", "Winner", "winning_team", "winning faction"]),
  );
  if (!winner || !match.teams) {
    return null;
  }

  const directFaction = normalizeFactionToken(
    match.faction ?? match.team ?? pickExistingValue(match.stats, ["faction", "team", "player_faction", "i1"]),
  );
  if (directFaction) {
    return directFaction === winner;
  }

  for (const [teamKey, team] of Object.entries(match.teams)) {
    const roster = Array.isArray(team.roster) ? team.roster : [];
    const dynamicPlayers = Array.isArray(team.players) ? team.players : [];
    const containsPlayer =
      roster.some((entry) => entry.player_id === playerId) ||
      dynamicPlayers.some((entry) => String(entry.player_id ?? entry.playerId ?? "") === playerId);

    if (!containsPlayer) {
      continue;
    }

    const tokens = new Set([
      normalizeFactionToken(teamKey),
      normalizeFactionToken(team.faction_id),
      normalizeFactionToken(team.team_id),
      normalizeToken(team.name),
    ]);

    return tokens.has(winner);
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

function resolveKillsFromHistory(match: PlayerMatch): number | null {
  const raw = pickExistingValue(match.stats, ["Kills", "kills", "K", "k", "Total Kills", "total_kills", "i6"]);
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const kills = parseDecimal(raw);
  return Number.isFinite(kills) ? kills : null;
}

function resolveDeathsFromHistory(match: PlayerMatch): number | null {
  const raw = pickExistingValue(match.stats, ["Deaths", "deaths", "D", "d", "Total Deaths", "total_deaths", "i8"]);
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const deaths = parseDecimal(raw);
  return Number.isFinite(deaths) ? deaths : null;
}

function resolveMapFromHistory(match: PlayerMatch): string {
  const mapRaw =
    pickExistingValue(match.stats, ["Map", "map", "Map Name", "map_name", "i1", "Map pick"]) ??
    match.competition_name ??
    match.competition;
  return normalizeMapName(mapRaw);
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
    const sum = kills.reduce((acc, value) => acc + value, 0);
    return { avg: Math.round(sum / kills.length), resolvedMatches: kills.length };
  }

  const fallbackAvg = parseDecimal(
    findValueByKey(lifetime, ["Average Kills", "Average Kills per Match", "Avg Kills", "average_kills", "avg_kills"]),
  );
  if (fallbackAvg > 0) {
    return { avg: Math.round(fallbackAvg), resolvedMatches: 0 };
  }

  return { avg: 0, resolvedMatches: 0 };
}

function extractTotalStats(lifetime: Record<string, unknown> | undefined): WindowStats {
  const matches = parseNumber(findValueByKey(lifetime, ["Matches", "matches", "Total Matches", "total_matches"]));
  const wins = parseNumber(findValueByKey(lifetime, ["Wins", "wins", "Total Wins", "total_wins"]));
  return {
    matches,
    wins,
    losses: Math.max(matches - wins, 0),
  };
}

function extractMapStats(stats: FaceitPlayerStats): MapStats[] {
  const byMap = new Map<string, { matches: number; wins: number; losses: number; weightedWinRate: number; weightedKd: number; weightedAvgKills: number }>();

  for (const segment of stats.segments ?? []) {
    const label = (segment.label ?? "").trim();
    if (!label || /^overall$/i.test(label)) {
      continue;
    }

    const type = (segment.type ?? "").trim();
    const isMapSegment = /map/i.test(type) || /^de_/i.test(label) || /^cs_/i.test(label);
    if (!isMapSegment) {
      continue;
    }

    const segmentStats = segment.stats;
    const matches = parseNumber(findValueByKey(segmentStats, ["Matches", "matches"]));
    if (matches <= 0) {
      continue;
    }

    const wins = parseNumber(findValueByKey(segmentStats, ["Wins", "wins"]));
    const directWinRate = parsePercent(
      findValueByKey(segmentStats, ["Win Rate %", "Win Rate", "Winrate", "win_rate", "win_rate_pct", "win_rate_percent"]),
    );
    const computedWinRate = matches > 0 ? (wins / matches) * 100 : 0;
    const winRate = Math.max(0, Math.min(100, directWinRate > 0 ? directWinRate : computedWinRate));
    const losses = Math.max(matches - wins, 0);

    const kd = parseDecimal(findValueByKey(segmentStats, ["Average K/D Ratio", "Average KD Ratio", "K/D Ratio", "K/D", "kd"]));
    const avgKills = parseDecimal(findValueByKey(segmentStats, ["Average Kills", "Avg Kills", "average_kills", "avg_kills"]));

    const map = normalizeMapName(label);
    const prev = byMap.get(map);
    if (!prev) {
      byMap.set(map, {
        matches,
        wins,
        losses,
        weightedWinRate: winRate * matches,
        weightedKd: kd * matches,
        weightedAvgKills: avgKills * matches,
      });
      continue;
    }

    byMap.set(map, {
      matches: prev.matches + matches,
      wins: prev.wins + wins,
      losses: prev.losses + losses,
      weightedWinRate: prev.weightedWinRate + winRate * matches,
      weightedKd: prev.weightedKd + kd * matches,
      weightedAvgKills: prev.weightedAvgKills + avgKills * matches,
    });
  }

  return [...byMap.entries()]
    .map(([map, value]) => ({
      map,
      matches: value.matches,
      wins: value.wins,
      losses: value.losses,
      winRate: Number((value.weightedWinRate / Math.max(value.matches, 1)).toFixed(1)),
      kd: Number((value.weightedKd / Math.max(value.matches, 1)).toFixed(2)),
      avgKills: Number((value.weightedAvgKills / Math.max(value.matches, 1)).toFixed(1)),
    }))
    .sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map));
}

function extractActivity(history: PlayerMatch[]): ActivityInfo {
  const ordered = [...history].sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a));
  const activeMatch = ordered.find((match) => {
    if (isFinishedMatch(match)) {
      return false;
    }
    const status = normalizeToken(match.status);
    if (!status) {
      return Boolean(match.match_id);
    }
    return ["ongoing", "started", "configuring", "configured", "voting", "ready", "captainpick", "checkin"].includes(status);
  });

  const matchId = String(activeMatch?.match_id ?? "").trim();
  if (!matchId) {
    return { inMatch: false };
  }

  return {
    inMatch: true,
    matchId,
    matchUrl: `https://www.faceit.com/ru/cs2/room/${matchId}`,
  };
}

function extractLastFinishedMatch(history: PlayerMatch[], playerId: string): LastMatchInfo | null {
  const completed = history
    .filter(isFinishedMatch)
    .sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a));

  const latest = completed[0];
  if (!latest) {
    return null;
  }

  const matchId = String(latest.match_id ?? "").trim();
  if (!matchId) {
    return null;
  }

  return {
    matchId,
    matchUrl: `https://www.faceit.com/ru/cs2/room/${matchId}`,
    playedAtIso: new Date(getMatchTimestamp(latest) * 1000).toISOString(),
    map: resolveMapFromHistory(latest),
    win: detectWinForPlayer(latest, playerId),
    kills: resolveKillsFromHistory(latest),
    deaths: resolveDeathsFromHistory(latest),
  };
}

async function loadPlayerStats(nickname: string, env: Env): Promise<PlayerViewModel> {
  const key = nickname.toLowerCase();
  const cached = playerMemoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const player = await faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}`, env);
  const [stats, history] = await Promise.all([
    faceitFetch<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}`, env),
    fetchRecentHistory(player.player_id, env),
  ]);

  const lifetime = stats.lifetime;
  const daySource = history.filter(isMatchFromTodayMoscow);
  const monthSource = history.filter((match) => getMatchTimestamp(match) >= startOfMonthUnixMoscow());
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
    faceitUrl: `https://www.faceit.com/ru/players/${player.nickname}`,
    hasPremium: detectPremium(player),
    elo: parseNumber(player.games?.[GAME_ID]?.faceit_elo),
    kd,
    avg: avgData.avg,
    avgMatchesCount: avgData.resolvedMatches,
    maps: extractMapStats(stats),
    day,
    month,
    total: extractTotalStats(lifetime),
    activity: extractActivity(history),
    lastMatch: extractLastFinishedMatch(history, player.player_id),
  };

  playerMemoryCache.set(key, {
    expiresAt: Date.now() + PLAYER_CACHE_TTL_MS,
    payload,
  });

  return payload;
}

async function searchPlayers(query: string, env: Env): Promise<SearchApiResponse> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { items: [] };
  }

  const params = new URLSearchParams({ nickname: trimmed, offset: "0", limit: "8" });
  const response = await faceitFetch<FaceitSearchResponse>(`/search/players?${params.toString()}`, env, 1);
  const items = (response.items ?? [])
    .map((item) => ({
      nickname: String(item.nickname ?? "").trim(),
      avatar: String(item.avatar ?? FALLBACK_AVATAR),
      elo: parseNumber(item.games?.[GAME_ID]?.faceit_elo),
    }))
    .filter((item) => item.nickname);

  return { items };
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

    const validPaths = new Set(["/api/stats", "/api/player-stats", "/api/search-players"]);
    if (!validPaths.has(url.pathname)) {
      return json({ error: "Not Found" }, { status: 404, headers });
    }

    if (!env.FACEIT_API_KEY) {
      return json({ error: "FACEIT_API_KEY is missing" }, { status: 500, headers });
    }

    try {
      if (url.pathname === "/api/search-players") {
        const query = url.searchParams.get("nickname") ?? "";
        const payload = await searchPlayers(query, env);
        return json(payload, { headers });
      }

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
          return json(
            {
              updatedAtIso: new Date().toISOString(),
              player: null,
              error: message,
            } satisfies PlayerApiResponse,
            { status: 200, headers },
          );
        }
      }

      if (memoryCache && memoryCache.expiresAt > Date.now()) {
        return json(memoryCache.payload, { headers });
      }

      const settled = await Promise.allSettled(DEFAULT_PLAYER_NICKNAMES.map((nickname) => loadPlayerStats(nickname, env)));
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