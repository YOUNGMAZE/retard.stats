import { useCallback, useEffect, useMemo, useState } from "react";

const FACEIT_API_BASE_URL = "https://open.faceit.com/data/v4";
const FACEIT_API_KEY = import.meta.env.VITE_FACEIT_API_KEY || "fbc26c3e-f22d-4d97-9dfc-6ea4102f51fb";
const GAME_ID = "cs2";
const REFRESH_MS = 60_000;
const PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];

type WindowStats = {
  matches: number;
  wins: number;
  losses: number;
};

type FaceitPlayer = {
  avatar?: string;
  nickname: string;
  player_id: string;
  faceit_url?: string;
  games?: {
    [key: string]: {
      faceit_elo?: number;
    };
  };
};

type FaceitPlayerStats = {
  lifetime?: Record<string, unknown>;
};

type PlayerMatch = {
  teams?: Record<string, { faction_id?: string; team_id?: string; name?: string; roster?: Array<{ player_id?: string }> }>;
  results?: {
    winner?: string;
  };
  winner?: string;
  i10?: string;
  status?: string;
  stats?: {
    i10?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PlayerViewModel = {
  nickname: string;
  playerId: string;
  avatar: string;
  faceitUrl: string;
  elo: number;
  day: WindowStats;
  month: WindowStats;
  total: WindowStats;
};

const FALLBACK_AVATAR = "https://cdn-frontend.faceit-cdn.net/web/300/src/app/assets/images/no-avatar.jpg";

function parseNumericValue(rawValue: unknown): number {
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseWinFlag(rawValue: unknown): boolean | null {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  const normalized = String(rawValue).trim().toLowerCase();

  if (normalized === "1" || normalized === "true" || normalized === "win" || normalized === "won") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "loss" || normalized === "lose" || normalized === "lost") {
    return false;
  }

  return null;
}

function normalizeToken(rawValue: unknown): string {
  return String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractWinFlagFromMatch(match: PlayerMatch): boolean | null {
  const directFlag = parseWinFlag(match.i10);
  if (directFlag !== null) {
    return directFlag;
  }

  const statsFlag = parseWinFlag(match.stats?.i10);
  if (statsFlag !== null) {
    return statsFlag;
  }

  return null;
}

function startOfTodayUnix(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function startOfMonthUnix(): number {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

async function fetchFaceit<T>(path: string): Promise<T> {
  const response = await fetch(`${FACEIT_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${FACEIT_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`FACEIT API error: ${response.status}`);
  }

  return (await response.json()) as T;
}

function detectWinForPlayer(match: PlayerMatch, playerId: string): boolean {
  // FACEIT can place per-player win marker in different fields.
  // Prefer this source because it's less ambiguous than winner/team matching.
  const winByFlag = extractWinFlagFromMatch(match);
  if (winByFlag !== null) {
    return winByFlag;
  }

  const teams = match.teams ?? {};
  const winner = match.results?.winner ?? match.winner;

  if (!winner) {
    return false;
  }

  const normalizedWinner = normalizeToken(winner);

  for (const [teamKey, teamData] of Object.entries(teams)) {
    const hasPlayer = teamData.roster?.some((entry) => entry.player_id === playerId);

    if (!hasPlayer) {
      continue;
    }

    const teamTokens = new Set([
      normalizeToken(teamKey),
      normalizeToken(teamData.faction_id),
      normalizeToken(teamData.team_id),
      normalizeToken(teamData.name),
    ]);

    // Some FACEIT payloads use winner values like f1/f2 or 1/2.
    if (teamTokens.has("faction1") || teamTokens.has("f1") || teamTokens.has("1")) {
      teamTokens.add("f1");
      teamTokens.add("faction1");
      teamTokens.add("1");
    }

    if (teamTokens.has("faction2") || teamTokens.has("f2") || teamTokens.has("2")) {
      teamTokens.add("f2");
      teamTokens.add("faction2");
      teamTokens.add("2");
    }

    return teamTokens.has(normalizedWinner);
  }

  return false;
}

function isFinishedMatch(match: PlayerMatch): boolean {
  const status = normalizeToken(match.status);
  return !status || status === "finished";
}

function summarizeMatches(matches: PlayerMatch[], playerId: string): WindowStats {
  const completedMatches = matches.filter(isFinishedMatch);
  const wins = completedMatches.reduce((total, match) => total + (detectWinForPlayer(match, playerId) ? 1 : 0), 0);
  const matchCount = completedMatches.length;

  return {
    matches: matchCount,
    wins,
    losses: Math.max(matchCount - wins, 0),
  };
}

function extractTotalStats(lifetime: Record<string, unknown> | undefined): WindowStats {
  if (!lifetime) {
    return { matches: 0, wins: 0, losses: 0 };
  }

  const totalMatches = parseNumericValue(lifetime.Matches ?? lifetime.matches);
  const totalWins = parseNumericValue(lifetime.Wins ?? lifetime.wins);

  return {
    matches: totalMatches,
    wins: totalWins,
    losses: Math.max(totalMatches - totalWins, 0),
  };
}

async function fetchAllMatchesForWindow(playerId: string, fromUnix: number, toUnix: number): Promise<PlayerMatch[]> {
  const pageLimit = 100;
  const maxMatches = 300;
  let offset = 0;
  const allMatches: PlayerMatch[] = [];

  while (offset < maxMatches) {
    const query = new URLSearchParams({
      game: GAME_ID,
      from: String(fromUnix),
      to: String(toUnix),
      offset: String(offset),
      limit: String(pageLimit),
    });

    const response = await fetchFaceit<{ items?: PlayerMatch[] }>(`/players/${playerId}/history?${query.toString()}`);
    const items = response.items ?? [];
    allMatches.push(...items);

    if (items.length < pageLimit) {
      break;
    }

    offset += pageLimit;
  }

  return allMatches;
}

async function loadPlayerStats(nickname: string): Promise<PlayerViewModel> {
  const player = await fetchFaceit<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}`);
  const stats = await fetchFaceit<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}`);

  const nowUnix = Math.floor(Date.now() / 1000);
  const [dayMatches, monthMatches] = await Promise.all([
    fetchAllMatchesForWindow(player.player_id, startOfTodayUnix(), nowUnix),
    fetchAllMatchesForWindow(player.player_id, startOfMonthUnix(), nowUnix),
  ]);

  return {
    nickname: player.nickname,
    playerId: player.player_id,
    avatar: player.avatar || FALLBACK_AVATAR,
    faceitUrl: player.faceit_url || `https://www.faceit.com/ru/players/${player.nickname}`,
    elo: parseNumericValue(player.games?.[GAME_ID]?.faceit_elo),
    day: summarizeMatches(dayMatches, player.player_id),
    month: summarizeMatches(monthMatches, player.player_id),
    total: extractTotalStats(stats.lifetime),
  };
}

function StatColumn({ label, value }: { label: string; value: WindowStats }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm sm:text-base">
      <span className="text-zinc-400">{label}</span>
      <span>
        Матчи <b className="text-zinc-100">{value.matches}</b>
      </span>
      <span>
        W/L <b className="text-emerald-300">{value.wins}</b>
        <span className="text-zinc-500">/</span>
        <b className="text-rose-300">{value.losses}</b>
      </span>
    </div>
  );
}

export default function App() {
  const [players, setPlayers] = useState<PlayerViewModel[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const loadStats = useCallback(async () => {
    if (!FACEIT_API_KEY) {
      setIsInitialLoading(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const payload = await Promise.all(PLAYER_NICKNAMES.map((nickname) => loadPlayerStats(nickname)));
      setPlayers(payload);
      setErrorText(null);
      setUpdatedAt(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить данные FACEIT";
      setErrorText(message);
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const intervalId = window.setInterval(() => {
      void loadStats();
    }, REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadStats]);

  useEffect(() => {
    const tickId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(tickId);
  }, []);

  const secondsToNextRefresh = useMemo(() => {
    if (!updatedAt) {
      return REFRESH_MS / 1000;
    }

    const elapsed = nowTick - updatedAt.getTime();
    const remainder = Math.max(REFRESH_MS - elapsed, 0);
    return Math.ceil(remainder / 1000);
  }, [nowTick, updatedAt]);

  if (!FACEIT_API_KEY) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-12 text-zinc-100">
        <div className="hero-ambient pointer-events-none absolute inset-0" />
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">FACEIT ELO LIVE</h1>
          <p className="max-w-2xl text-zinc-300">
            Добавьте API-ключ FACEIT в переменную <b>VITE_FACEIT_API_KEY</b>, чтобы запустить отслеживание в реальном времени.
          </p>
          <p className="text-sm text-zinc-500">Создайте файл .env и укажите: VITE_FACEIT_API_KEY=ваш_ключ</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-8 text-zinc-100 sm:py-12">
      <div className="hero-ambient pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">FACEIT ELO LIVE</h1>
          <p className="max-w-3xl text-zinc-300 sm:text-lg">
            Статистика по игрокам <b>mazedaddy</b>, <b>SEXN</b> и <b>unborrasq</b> обновляется автоматически каждые 60 секунд.
          </p>

          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <span className="inline-flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${isRefreshing ? "bg-emerald-400 pulse-dot" : "bg-zinc-500"}`} />
              {isRefreshing ? "Обновление..." : "Данные актуальны"}
            </span>
            <span>Следующее обновление через {secondsToNextRefresh}с</span>
            <button
              type="button"
              onClick={() => void loadStats()}
              className="border-b border-zinc-500 text-zinc-100 transition hover:border-zinc-100"
            >
              Обновить сейчас
            </button>
          </div>

          {updatedAt ? <p className="text-xs text-zinc-500">Последнее обновление: {updatedAt.toLocaleString("ru-RU")}</p> : null}
        </header>

        {errorText ? <p className="text-sm text-rose-300">Ошибка загрузки: {errorText}</p> : null}

        {isInitialLoading ? (
          <div className="flex items-center gap-3 text-zinc-300">
            <span className="h-4 w-4 rounded-full border-2 border-zinc-600 border-t-zinc-100 spinner" />
            Загружаем статистику игроков...
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/80 border-y border-zinc-800/80">
            {players.map((player) => (
              <li key={player.playerId} className="fade-in py-6 sm:py-8">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <img src={player.avatar} alt={player.nickname} className="h-14 w-14 rounded-full border border-zinc-700 object-cover" />
                    <div>
                      <a
                        href={player.faceitUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xl font-semibold tracking-tight transition hover:text-orange-300"
                      >
                        {player.nickname}
                      </a>
                      <p className="text-sm text-zinc-400">FACEIT ELO</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-orange-300 sm:text-4xl">{player.elo}</p>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">текущее эло</p>
                  </div>
                </div>

                <div className="space-y-2 text-zinc-300">
                  <StatColumn label="За день" value={player.day} />
                  <StatColumn label="За месяц" value={player.month} />
                  <StatColumn label="За всё время" value={player.total} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
