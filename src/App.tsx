import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_MS = 60_000;
const LOCAL_CACHE_KEY = "retard-stats-cache-v1";
const DEFAULT_STATS_API_URL = "https://retard-stats-api.wladjika25.workers.dev";
const STATS_API_URL = (import.meta.env.VITE_STATS_API_URL || DEFAULT_STATS_API_URL).trim().replace(/\/+$/, "");
const PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];

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

function normalizeWindowStats(value: unknown): WindowStats {
  const source = (value ?? {}) as Partial<WindowStats>;
  return {
    matches: Number.isFinite(Number(source.matches)) ? Number(source.matches) : 0,
    wins: Number.isFinite(Number(source.wins)) ? Number(source.wins) : 0,
    losses: Number.isFinite(Number(source.losses)) ? Number(source.losses) : 0,
  };
}

function normalizePlayer(value: unknown): PlayerViewModel | null {
  const source = (value ?? {}) as Partial<PlayerViewModel>;
  const nickname = String(source.nickname ?? "").trim();
  const playerId = String(source.playerId ?? "").trim();
  if (!nickname || !playerId) {
    return null;
  }

  const mapsRaw = Array.isArray(source.maps) ? source.maps : [];
  const maps = mapsRaw
    .map((entry) => {
      const mapName = String((entry as { map?: unknown })?.map ?? "").trim();
      if (!mapName) {
        return null;
      }

      const matches = Number((entry as { matches?: unknown })?.matches ?? 0);
      const winRate = Number((entry as { winRate?: unknown })?.winRate ?? 0);
      return {
        map: mapName,
        matches: Number.isFinite(matches) ? matches : 0,
        winRate: Number.isFinite(winRate) ? winRate : 0,
      };
    })
    .filter((entry): entry is { map: string; matches: number; winRate: number } => entry !== null);

  return {
    nickname,
    playerId,
    avatar: String(source.avatar ?? ""),
    faceitUrl: String(source.faceitUrl ?? `https://www.faceit.com/ru/players/${nickname}`),
    elo: Number.isFinite(Number(source.elo)) ? Number(source.elo) : 0,
    kd: Number.isFinite(Number(source.kd)) ? Number(source.kd) : 0,
    avg: Number.isFinite(Number(source.avg)) ? Number(source.avg) : 0,
    avgMatchesCount: Number.isFinite(Number(source.avgMatchesCount)) ? Number(source.avgMatchesCount) : 0,
    maps,
    day: normalizeWindowStats(source.day),
    month: normalizeWindowStats(source.month),
    total: normalizeWindowStats(source.total),
  };
}

function formatStatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function getBestMapName(maps: Array<{ map: string; matches: number; winRate: number }>): string | null {
  if (!maps.length) {
    return null;
  }

  const best = maps.reduce((currentBest, item) => {
    if (!currentBest) {
      return item;
    }

    if (item.winRate > currentBest.winRate) {
      return item;
    }

    if (item.winRate === currentBest.winRate && item.matches > currentBest.matches) {
      return item;
    }

    return currentBest;
  }, maps[0]);

  return best.map;
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
  const playersRef = useRef<PlayerViewModel[]>([]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if (!raw) {
        return;
      }

      const cached = JSON.parse(raw) as ApiStatsResponse;
      if (!Array.isArray(cached.players)) {
        return;
      }

      const normalizedCachedPlayers = cached.players
        .map((entry) => normalizePlayer(entry))
        .filter((entry): entry is PlayerViewModel => entry !== null);
      if (!normalizedCachedPlayers.length) {
        return;
      }

      setPlayers(normalizedCachedPlayers);
      setUpdatedAt(cached.updatedAtIso ? new Date(cached.updatedAtIso) : new Date());
      setIsInitialLoading(false);
    } catch {
      // Ignore broken cache payloads and continue with network loading.
    }
  }, []);

  const loadStats = useCallback(async () => {
    if (!STATS_API_URL) {
      setErrorText("Не указан server-side API URL");
      setIsInitialLoading(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const settled = await Promise.allSettled(
        PLAYER_NICKNAMES.map(async (nickname) => {
          const response = await fetch(`${STATS_API_URL}/api/player-stats?nickname=${encodeURIComponent(nickname)}`, {
            headers: { Accept: "application/json" },
          });

          if (!response.ok) {
            let serverMessage = "";
            try {
              const serverPayload = (await response.json()) as { error?: string };
              serverMessage = serverPayload.error ?? "";
            } catch {
              // Ignore non-json error payloads.
            }
            throw new Error(serverMessage ? `Ошибка API: ${response.status} (${serverMessage})` : `Ошибка API: ${response.status}`);
          }

          const payload = (await response.json()) as PlayerApiResponse;
          const normalizedPlayer = normalizePlayer(payload.player);
          if (!normalizedPlayer) {
            throw new Error(payload.error || `Игрок ${nickname}: нет данных`);
          }

          return {
            player: normalizedPlayer,
            updatedAtIso: payload.updatedAtIso,
          };
        }),
      );

      const loadedPlayers: PlayerViewModel[] = [];
      const updatedAtStamps: number[] = [];
      const errors: string[] = [];

      for (const result of settled) {
        if (result.status === "fulfilled") {
          loadedPlayers.push(result.value.player);
          updatedAtStamps.push(new Date(result.value.updatedAtIso).getTime());
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : "Ошибка загрузки игрока");
        }
      }

      const orderedPlayers = PLAYER_NICKNAMES.map(
        (nickname) => loadedPlayers.find((player) => player.nickname.toLowerCase() === nickname.toLowerCase()) ?? null,
      ).filter((item): item is PlayerViewModel => item !== null);

      if (!orderedPlayers.length) {
        if (playersRef.current.length > 0) {
          setErrorText("FACEIT API временно недоступен. Показаны последние сохраненные данные.");
        } else {
          setErrorText(errors[0] || "FACEIT API временно не вернул данные.");
        }
        return;
      }

      const payload: ApiStatsResponse = {
        updatedAtIso: new Date(Math.max(...updatedAtStamps, Date.now())).toISOString(),
        players: orderedPlayers,
      };

      setPlayers(payload.players);
      setUpdatedAt(new Date(payload.updatedAtIso));
      setErrorText(errors.length ? `Часть данных могла не обновиться: ${errors[0]}` : null);
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(payload));
      } catch {
        // Non-blocking cache write.
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Не удалось загрузить данные";
      const normalized = rawMessage.toLowerCase();
      const networkLikeError = normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed");

      if (playersRef.current.length > 0) {
        setErrorText("Временная проблема с API. Показаны последние сохраненные данные.");
      } else if (networkLikeError) {
        setErrorText("Сеть недоступна или API не отвечает. Попробуй обновить страницу через 10-20 секунд.");
      } else {
        setErrorText(rawMessage);
      }
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

  if (!STATS_API_URL) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-12 text-zinc-100">
        <div className="hero-ambient pointer-events-none absolute inset-0" />
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">RETARD STATS</h1>
          <p className="max-w-2xl text-zinc-300">
            Добавь URL server-side API в переменную <b>VITE_STATS_API_URL</b>, чтобы запустить отслеживание в реальном времени.
          </p>
          <p className="text-sm text-zinc-500">Пример .env: VITE_STATS_API_URL=https://your-worker.your-subdomain.workers.dev</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-8 text-zinc-100 sm:py-12">
      <div className="hero-ambient pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">RETARD STATS</h1>
          <p className="max-w-3xl text-zinc-300 sm:text-lg">
            Статистика по игрокам <b>mazedaddy</b>, <b>SEXN</b> и <b>unborrasq</b> обновляется автоматически каждые 60 секунд.
          </p>
          <p className="text-sm text-zinc-500">Период "за день" считается по московскому времени (UTC+3).</p>

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
            {players.map((player) => {
              const bestMapName = getBestMapName(player.maps);

              return (
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
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                        <span className="text-zinc-400">FACEIT ELO</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-orange-300 sm:text-4xl">{player.elo}</p>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">текущее эло</p>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-5 text-sm text-zinc-300">
                  <p>
                    Общий K/D <b className="text-zinc-100">{formatStatNumber(player.kd)}</b>
                  </p>
                  <p>
                    AVG (kills, 30 матчей) <b className="text-zinc-100">{formatStatNumber(player.avg, 0)}</b>
                    <span className="text-zinc-500"> [{player.avgMatchesCount}]</span>
                  </p>
                </div>

                <div className="space-y-2 text-zinc-300">
                  <StatColumn label="За день" value={player.day} />
                  <StatColumn label="За месяц" value={player.month} />
                  <StatColumn label="За всё время" value={player.total} />
                </div>

                <div className="mt-4 text-sm text-zinc-300">
                  <p className="mb-2 text-zinc-400">Матчи по картам</p>
                  {player.maps.length ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {player.maps.map((entry) => (
                        <span key={`${player.playerId}-${entry.map}`}>
                          {entry.map}: <b className="text-zinc-100">{entry.matches}</b>
                          <span className="text-zinc-500"> | WR </span>
                          <b className="text-zinc-100">{formatStatNumber(entry.winRate, 1)}%</b>
                          {bestMapName === entry.map ? <b className="ml-2 text-yellow-300">best map</b> : null}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-zinc-500">Нет данных по картам.</p>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}