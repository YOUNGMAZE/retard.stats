import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_MS = 60_000;
const LOCAL_CACHE_KEY = "retard-stats-cache-v2";
const LOCAL_LAYOUT_KEY = "retard-stats-layout-v1";
const LOCAL_PLAYERS_KEY = "retard-stats-players-v1";
const LOCAL_AUTH_TOKEN_KEY = "retard-stats-auth-token-v1";
const ADMIN_USERNAME_NORMALIZED = "maze";
const DEFAULT_STATS_API_URL = "https://retard-stats-api.wladjika25.workers.dev";
const STATS_API_URL = (import.meta.env.VITE_STATS_API_URL || DEFAULT_STATS_API_URL).trim().replace(/\/+$/, "");
const DEFAULT_PLAYERS = ["mazedaddy", "SEXN", "unborrasq"];
const MAX_SELECTED_PLAYERS = 8;

type LayoutMode = "row" | "column" | "mini";

type WindowStats = {
  matches: number;
  wins: number;
  losses: number;
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

type MapStats = {
  map: string;
  matches: number;
  winRate: number;
  wins: number;
  losses: number;
  kd: number;
  avgKills: number;
};

type WeaponStats = {
  weapon: string;
  matches: number;
  kills: number;
  hitRate: number;
  avgKills: number;
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
  weapons: WeaponStats[];
  favoriteWeapon: WeaponStats | null;
  day: WindowStats;
  month: WindowStats;
  total: WindowStats;
  activity: ActivityInfo;
  lastMatch: LastMatchInfo | null;
};

type CachePayload = {
  updatedAtIso: string;
  players: PlayerViewModel[];
};

type PlayerApiResponse = {
  updatedAtIso: string;
  player: PlayerViewModel | null;
  error?: string;
};

type SearchResult = {
  nickname: string;
  avatar: string;
  elo: number;
};

type AuthResponse = {
  token?: string;
  username?: string;
  error?: string;
};

type RegisteredUser = {
  username: string;
  createdAtIso: string;
};

type AuthUsersResponse = {
  count?: number;
  users?: RegisteredUser[];
  error?: string;
};

function buildFaceitProfileUrl(nickname: string): string {
  return `https://www.faceit.com/ru/players/${encodeURIComponent(nickname)}`;
}

function parseSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWindowStats(value: unknown): WindowStats {
  const source = (value ?? {}) as Partial<WindowStats>;
  return {
    matches: parseSafeNumber(source.matches),
    wins: parseSafeNumber(source.wins),
    losses: parseSafeNumber(source.losses),
  };
}

function normalizeActivity(value: unknown): ActivityInfo {
  const source = (value ?? {}) as Partial<ActivityInfo>;
  const inMatch = Boolean(source.inMatch);
  const matchId = String(source.matchId ?? "").trim();
  const matchUrl = String(source.matchUrl ?? "").trim();
  return {
    inMatch,
    matchId: inMatch && matchId ? matchId : undefined,
    matchUrl: inMatch && matchUrl ? matchUrl : undefined,
  };
}

function normalizeLastMatch(value: unknown): LastMatchInfo | null {
  const source = (value ?? {}) as Partial<LastMatchInfo>;
  const matchId = String(source.matchId ?? "").trim();
  if (!matchId) {
    return null;
  }

  const matchUrl = String(source.matchUrl ?? "").trim();
  const map = String(source.map ?? "").trim() || "Unknown";
  const winRaw = source.win;
  const win = typeof winRaw === "boolean" ? winRaw : null;

  return {
    matchId,
    matchUrl: matchUrl || `https://www.faceit.com/ru/cs2/room/${matchId}`,
    playedAtIso: String(source.playedAtIso ?? ""),
    map,
    win,
    kills: source.kills === null || source.kills === undefined ? null : parseSafeNumber(source.kills, 0),
    deaths: source.deaths === null || source.deaths === undefined ? null : parseSafeNumber(source.deaths, 0),
  };
}

function normalizeMaps(value: unknown): MapStats[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const row = (entry ?? {}) as Partial<MapStats>;
      const map = String(row.map ?? "").trim();
      if (!map) {
        return null;
      }

      return {
        map,
        matches: parseSafeNumber(row.matches),
        winRate: parseSafeNumber(row.winRate),
        wins: parseSafeNumber(row.wins),
        losses: parseSafeNumber(row.losses),
        kd: parseSafeNumber(row.kd),
        avgKills: parseSafeNumber(row.avgKills),
      };
    })
    .filter((entry): entry is MapStats => entry !== null);
}

function normalizeWeapons(value: unknown): WeaponStats[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const row = (entry ?? {}) as Partial<WeaponStats>;
      const weapon = String(row.weapon ?? "").trim();
      if (!weapon) {
        return null;
      }

      return {
        weapon,
        matches: parseSafeNumber(row.matches),
        kills: parseSafeNumber(row.kills),
        hitRate: parseSafeNumber(row.hitRate),
        avgKills: parseSafeNumber(row.avgKills),
      };
    })
    .filter((entry): entry is WeaponStats => entry !== null);
}

function normalizeFavoriteWeapon(value: unknown): WeaponStats | null {
  const row = (value ?? {}) as Partial<WeaponStats>;
  const weapon = String(row.weapon ?? "").trim();
  if (!weapon) {
    return null;
  }

  return {
    weapon,
    matches: parseSafeNumber(row.matches),
    kills: parseSafeNumber(row.kills),
    hitRate: parseSafeNumber(row.hitRate),
    avgKills: parseSafeNumber(row.avgKills),
  };
}

function normalizePlayer(value: unknown): PlayerViewModel | null {
  const source = (value ?? {}) as Partial<PlayerViewModel>;
  const nickname = String(source.nickname ?? "").trim();
  const playerId = String(source.playerId ?? "").trim();
  if (!nickname || !playerId) {
    return null;
  }

  return {
    nickname,
    playerId,
    avatar: String(source.avatar ?? ""),
    faceitUrl: buildFaceitProfileUrl(nickname),
    hasPremium: Boolean(source.hasPremium),
    elo: parseSafeNumber(source.elo),
    kd: parseSafeNumber(source.kd),
    avg: parseSafeNumber(source.avg),
    avgMatchesCount: parseSafeNumber(source.avgMatchesCount),
    maps: normalizeMaps(source.maps),
    weapons: normalizeWeapons(source.weapons),
    favoriteWeapon: normalizeFavoriteWeapon(source.favoriteWeapon),
    day: normalizeWindowStats(source.day),
    month: normalizeWindowStats(source.month),
    total: normalizeWindowStats(source.total),
    activity: normalizeActivity(source.activity),
    lastMatch: normalizeLastMatch(source.lastMatch),
  };
}

function formatStatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function getFaceitLevel(elo: number): number {
  if (elo >= 2000) return 10;
  if (elo >= 1751) return 9;
  if (elo >= 1531) return 8;
  if (elo >= 1351) return 7;
  if (elo >= 1201) return 6;
  if (elo >= 1051) return 5;
  if (elo >= 901) return 4;
  if (elo >= 751) return 3;
  if (elo >= 501) return 2;
  return 1;
}

function getLevelRingColor(level: number): string {
  if (level === 10) return "#ff2a00";
  if (level >= 8) return "#ff6a00";
  if (level >= 4) return "#ffd21f";
  if (level >= 2) return "#38e600";
  return "#d9d9d9";
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mapPreviewUri(mapName: string): string {
  const palette = [
    ["#1f2937", "#374151"],
    ["#1f3b5b", "#275f87"],
    ["#3c1d47", "#6a2e7f"],
    ["#4a3413", "#8b5a1e"],
    ["#113631", "#1f6d61"],
  ] as const;
  const [start, end] = palette[hashString(mapName) % palette.length];
  const title = mapName.toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='140' viewBox='0 0 320 140'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${start}'/><stop offset='100%' stop-color='${end}'/></linearGradient></defs><rect width='320' height='140' fill='url(#g)'/><rect x='12' y='12' width='296' height='116' rx='10' ry='10' fill='rgba(8,10,14,0.28)'/><text x='22' y='84' fill='white' font-family='Arial,Helvetica,sans-serif' font-size='30' font-weight='700'>${title}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getBestMapName(maps: MapStats[]): string | null {
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

function LevelIcon({ level, className = "h-12 w-12" }: { level: number; className?: string }) {
  const ringColor = getLevelRingColor(level);

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="#171923" stroke="#2c2f39" strokeWidth="2" />
      <circle cx="50" cy="50" r="34" fill="#1b1d25" stroke="#2f333d" strokeWidth="10" />
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke={ringColor}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="168 220"
        transform="rotate(132 50 50)"
      />
      <text x="50" y="58" textAnchor="middle" fontSize="34" fontWeight="800" fill={ringColor}>
        {level}
      </text>
    </svg>
  );
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

function renderLastMatchLine(lastMatch: LastMatchInfo | null) {
  if (!lastMatch) {
    return <span className="text-zinc-500">Последний матч: нет данных</span>;
  }

  const resultLabel = lastMatch.win === null ? "N/A" : lastMatch.win ? "Победа" : "Поражение";
  const resultClass = lastMatch.win === null ? "text-zinc-400" : lastMatch.win ? "text-emerald-300" : "text-rose-300";
  const kdText =
    lastMatch.kills !== null && lastMatch.deaths !== null
      ? `${formatStatNumber(lastMatch.kills, 0)}/${formatStatNumber(lastMatch.deaths, 0)}`
      : "-/-";

  return (
    <span>
      Последний матч: {lastMatch.map} | <b className={resultClass}>{resultLabel}</b> | K/D <b className="text-zinc-100">{kdText}</b>
    </span>
  );
}

export default function App() {
  const [players, setPlayers] = useState<PlayerViewModel[]>([]);
  const [selectedNicknames, setSelectedNicknames] = useState<string[]>(DEFAULT_PLAYERS);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("column");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [expandedMaps, setExpandedMaps] = useState<Record<string, boolean>>({});
  const [expandedWeapons, setExpandedWeapons] = useState<Record<string, boolean>>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem(LOCAL_AUTH_TOKEN_KEY) ?? "");
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginInput, setLoginInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isUsersPanelOpen, setIsUsersPanelOpen] = useState(true);
  const playersRef = useRef<PlayerViewModel[]>([]);
  const isAdminUser = useMemo(() => String(authUsername ?? "").trim().toLowerCase() === ADMIN_USERNAME_NORMALIZED, [authUsername]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    if (!authToken) {
      setAuthUsername(null);
      setIsAuthChecking(false);
      localStorage.removeItem(LOCAL_AUTH_TOKEN_KEY);
      return;
    }

    let cancelled = false;

    const checkSession = async () => {
      setIsAuthChecking(true);
      try {
        const response = await fetch(`${STATS_API_URL}/api/auth/me`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Сессия истекла. Войди снова.");
        }

        const payload = (await response.json()) as { username?: string };
        if (!cancelled) {
          setAuthUsername(String(payload.username ?? "").trim() || null);
          setAuthError(null);
          localStorage.setItem(LOCAL_AUTH_TOKEN_KEY, authToken);
        }
      } catch {
        if (!cancelled) {
          setAuthUsername(null);
          setAuthToken("");
          localStorage.removeItem(LOCAL_AUTH_TOKEN_KEY);
        }
      } finally {
        if (!cancelled) {
          setIsAuthChecking(false);
        }
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const submitAuth = useCallback(async () => {
    const username = loginInput.trim();
    const password = passwordInput;

    if (!username || !password) {
      setAuthError("Введи логин и пароль");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);

    try {
      let tokenFromRegister = "";
      let usernameFromRegister = "";

      if (authMode === "register") {
        const registerResponse = await fetch(`${STATS_API_URL}/api/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ username, password }),
        });
        const registerPayload = (await registerResponse.json()) as AuthResponse;
        if (!registerResponse.ok) {
          throw new Error(registerPayload.error || "Ошибка регистрации");
        }

        tokenFromRegister = String(registerPayload.token ?? "").trim();
        usernameFromRegister = String(registerPayload.username ?? "").trim();

        if (tokenFromRegister) {
          localStorage.setItem(LOCAL_AUTH_TOKEN_KEY, tokenFromRegister);
          setAuthToken(tokenFromRegister);
          setAuthUsername(usernameFromRegister || username);
          setPasswordInput("");
          setAuthError(null);
          return;
        }
      }

      const loginResponse = await fetch(`${STATS_API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      const loginPayload = (await loginResponse.json()) as AuthResponse;

      if (!loginResponse.ok || !loginPayload.token) {
        throw new Error(loginPayload.error || "Ошибка входа");
      }

      localStorage.setItem(LOCAL_AUTH_TOKEN_KEY, loginPayload.token);
      setAuthToken(loginPayload.token);
      setAuthUsername(loginPayload.username || username);
      setPasswordInput("");
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось выполнить авторизацию");
    } finally {
      setIsAuthSubmitting(false);
    }
  }, [authMode, loginInput, passwordInput]);

  const logout = useCallback(async () => {
    if (authToken) {
      try {
        await fetch(`${STATS_API_URL}/api/auth/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
      } catch {
        // No-op.
      }
    }

    setAuthToken("");
    setAuthUsername(null);
    setPlayers([]);
    setRegisteredUsers([]);
    setUsersError(null);
    localStorage.removeItem(LOCAL_AUTH_TOKEN_KEY);
  }, [authToken]);

  const loadRegisteredUsers = useCallback(async () => {
    if (!authToken || !isAdminUser) {
      setRegisteredUsers([]);
      setUsersError(null);
      return;
    }

    setIsUsersLoading(true);
    setUsersError(null);

    try {
      const response = await fetch(`${STATS_API_URL}/api/auth/users`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });

      const payload = (await response.json()) as AuthUsersResponse;
      if (!response.ok) {
        throw new Error(payload.error || `Ошибка API: ${response.status}`);
      }

      const normalizedUsers = Array.isArray(payload.users)
        ? payload.users
            .map((entry) => ({
              username: String(entry.username ?? "").trim(),
              createdAtIso: String(entry.createdAtIso ?? "").trim(),
            }))
            .filter((entry) => entry.username && entry.createdAtIso)
        : [];

      setRegisteredUsers(normalizedUsers);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Не удалось загрузить список пользователей");
    } finally {
      setIsUsersLoading(false);
    }
  }, [authToken, isAdminUser]);

  useEffect(() => {
    if (!authUsername || !isAdminUser) {
      setRegisteredUsers([]);
      setUsersError(null);
      return;
    }

    void loadRegisteredUsers();
  }, [authUsername, isAdminUser, loadRegisteredUsers]);

  useEffect(() => {
    try {
      const rawLayout = localStorage.getItem(LOCAL_LAYOUT_KEY);
      if (rawLayout === "row" || rawLayout === "column" || rawLayout === "mini") {
        setLayoutMode(rawLayout);
      }

      const rawPlayers = localStorage.getItem(LOCAL_PLAYERS_KEY);
      if (rawPlayers) {
        const parsed = JSON.parse(rawPlayers) as string[];
        if (Array.isArray(parsed) && parsed.length) {
          const sanitized = parsed
            .map((nickname) => String(nickname ?? "").trim())
            .filter(Boolean)
            .slice(0, MAX_SELECTED_PLAYERS);
          if (sanitized.length) {
            setSelectedNicknames(sanitized);
          }
        }
      }

      const rawCache = localStorage.getItem(LOCAL_CACHE_KEY);
      if (!rawCache) {
        return;
      }

      const cached = JSON.parse(rawCache) as CachePayload;
      if (!Array.isArray(cached.players)) {
        return;
      }

      const normalizedPlayers = cached.players
        .map((item) => normalizePlayer(item))
        .filter((item): item is PlayerViewModel => item !== null);

      if (!normalizedPlayers.length) {
        return;
      }

      setPlayers(normalizedPlayers);
      setUpdatedAt(cached.updatedAtIso ? new Date(cached.updatedAtIso) : new Date());
      setIsInitialLoading(false);
    } catch {
      // Ignore broken local state values.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_LAYOUT_KEY, layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    localStorage.setItem(LOCAL_PLAYERS_KEY, JSON.stringify(selectedNicknames));
  }, [selectedNicknames]);

  const loadStats = useCallback(async () => {
    if (!STATS_API_URL) {
      setErrorText("Не указан server-side API URL");
      setIsInitialLoading(false);
      return;
    }

    if (!selectedNicknames.length) {
      setPlayers([]);
      setErrorText("Добавь хотя бы одного игрока для отслеживания.");
      setIsInitialLoading(false);
      return;
    }

    if (!authToken) {
      setPlayers([]);
      setErrorText("Нужен вход в аккаунт");
      setIsInitialLoading(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const settled = await Promise.allSettled(
        selectedNicknames.map(async (nickname) => {
          const response = await fetch(`${STATS_API_URL}/api/player-stats?nickname=${encodeURIComponent(nickname)}`, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${authToken}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Ошибка API: ${response.status}`);
          }

          const payload = (await response.json()) as PlayerApiResponse;
          const player = normalizePlayer(payload.player);
          if (!player) {
            throw new Error(payload.error || `Игрок ${nickname}: нет данных`);
          }

          return {
            updatedAtIso: payload.updatedAtIso,
            player,
          };
        }),
      );

      const loadedPlayers: PlayerViewModel[] = [];
      const errors: string[] = [];
      const updatedTimestamps: number[] = [];

      for (const result of settled) {
        if (result.status === "fulfilled") {
          loadedPlayers.push(result.value.player);
          updatedTimestamps.push(new Date(result.value.updatedAtIso).getTime());
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : "Ошибка загрузки игрока");
        }
      }

      const orderedPlayers = selectedNicknames
        .map((nickname) => loadedPlayers.find((player) => player.nickname.toLowerCase() === nickname.toLowerCase()) ?? null)
        .filter((item): item is PlayerViewModel => item !== null);

      if (!orderedPlayers.length) {
        setErrorText(playersRef.current.length ? "API временно недоступен. Показаны последние данные." : errors[0] || "Не удалось получить данные.");
        return;
      }

      const payload: CachePayload = {
        updatedAtIso: new Date(Math.max(...updatedTimestamps, Date.now())).toISOString(),
        players: orderedPlayers,
      };

      setPlayers(payload.players);
      setUpdatedAt(new Date(payload.updatedAtIso));
      setErrorText(errors.length ? `Часть игроков не обновилась: ${errors[0]}` : null);
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить данные";
      const normalized = message.toLowerCase();
      const networkLikeError = normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed");

      if (playersRef.current.length > 0) {
        setErrorText("Временная проблема с API. Показаны последние сохраненные данные.");
      } else if (networkLikeError) {
        setErrorText("Сеть недоступна или API не отвечает. Попробуй обновить страницу через 10-20 секунд.");
      } else {
        setErrorText(message);
      }
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedNicknames, authToken]);

  useEffect(() => {
    void loadStats();
    const intervalId = window.setInterval(() => {
      void loadStats();
    }, REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadStats]);

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      const query = searchQuery.trim();
      if (!query || query.length < 2 || !STATS_API_URL || !authToken) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(`${STATS_API_URL}/api/search-players?nickname=${encodeURIComponent(query)}`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) {
          setSearchResults([]);
          return;
        }

        const payload = (await response.json()) as { items?: SearchResult[] };
        const items = Array.isArray(payload.items)
          ? payload.items
              .map((item) => ({
                nickname: String(item.nickname ?? ""),
                avatar: String(item.avatar ?? ""),
                elo: parseSafeNumber(item.elo),
              }))
              .filter((item) => item.nickname)
          : [];
        setSearchResults(items);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, authToken]);

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

  const listClassName = useMemo(() => {
    if (layoutMode === "row") {
      return "grid grid-cols-1 gap-8 md:grid-cols-2";
    }
    if (layoutMode === "mini") {
      return "space-y-3";
    }
    return "divide-y divide-zinc-800/80 border-y border-zinc-800/80";
  }, [layoutMode]);

  const visiblePlayers = useMemo(() => {
    const byNickname = new Map(players.map((player) => [player.nickname.toLowerCase(), player]));
    return selectedNicknames
      .map((nickname) => byNickname.get(nickname.toLowerCase()) ?? null)
      .filter((player): player is PlayerViewModel => player !== null);
  }, [players, selectedNicknames]);

  const addPlayer = useCallback((nickname: string) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      return;
    }

    setSelectedNicknames((previous) => {
      const exists = previous.some((item) => item.toLowerCase() === trimmed.toLowerCase());
      if (exists || previous.length >= MAX_SELECTED_PLAYERS) {
        return previous;
      }
      return [...previous, trimmed];
    });
  }, []);

  const removePlayer = useCallback((nickname: string) => {
    setSelectedNicknames((previous) => previous.filter((item) => item.toLowerCase() !== nickname.toLowerCase()));
  }, []);

  const toggleMapPanel = useCallback((playerId: string, mapName: string) => {
    const key = `${playerId}:${mapName}`;
    setExpandedMaps((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }, []);

  const toggleWeaponPanel = useCallback((playerId: string) => {
    setExpandedWeapons((previous) => ({
      ...previous,
      [playerId]: !(previous[playerId] ?? true),
    }));
  }, []);

  if (isAuthChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-8 text-zinc-100">
        <p className="text-zinc-300">Проверка сессии...</p>
      </main>
    );
  }

  if (!authUsername) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-8 text-zinc-100">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 sm:p-8">
          <h1 className="text-3xl font-black tracking-tight">RETARD STATS</h1>

          <div className="mt-4 inline-flex rounded-md border border-zinc-700 bg-zinc-900/80 p-1 text-sm">
            {([
              ["login", "Вход"],
              ["register", "Регистрация"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAuthMode(mode)}
                className={`rounded px-3 py-1 transition ${authMode === mode ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:bg-zinc-800"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <input
              value={loginInput}
              onChange={(event) => setLoginInput(event.target.value)}
              autoComplete="username"
              placeholder="Логин"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
            />
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              autoComplete={authMode === "register" ? "new-password" : "current-password"}
              placeholder="Пароль"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => void submitAuth()}
              disabled={isAuthSubmitting}
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAuthSubmitting ? "Подожди..." : authMode === "register" ? "Зарегистрироваться" : "Войти"}
            </button>
            {authError ? <p className="text-sm text-rose-300">{authError}</p> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-8 text-zinc-100 sm:py-12">
      <div className="hero-ambient pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="space-y-4">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">RETARD STATS</h1>
          <p className="max-w-3xl text-zinc-300 sm:text-lg">Live FACEIT-статистика с автообновлением каждые 60 секунд.</p>

          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
            <span className="text-zinc-300">Аккаунт: {authUsername}</span>
            <button type="button" onClick={() => void logout()} className="border-b border-zinc-500 text-zinc-100 transition hover:border-zinc-100">
              Выйти
            </button>
            {isAdminUser ? (
              <button type="button" onClick={() => void loadRegisteredUsers()} className="border-b border-zinc-500 text-zinc-100 transition hover:border-zinc-100">
                Обновить пользователей
              </button>
            ) : null}
            <span className="inline-flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${isRefreshing ? "bg-emerald-400 pulse-dot" : "bg-zinc-500"}`} />
              {isRefreshing ? "Обновление..." : "Данные актуальны"}
            </span>
            <span>Следующее обновление через {secondsToNextRefresh}с</span>
            <button type="button" onClick={() => void loadStats()} className="border-b border-zinc-500 text-zinc-100 transition hover:border-zinc-100">
              Обновить сейчас
            </button>
          </div>

          {updatedAt ? <p className="text-xs text-zinc-500">Последнее обновление: {updatedAt.toLocaleString("ru-RU")}</p> : null}

          {isAdminUser ? (
            <div className="rounded-md border border-zinc-800/80 bg-zinc-900/40 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  Пользователей зарегистрировано: <b className="text-zinc-100">{registeredUsers.length}</b>
                </p>
                <button
                  type="button"
                  onClick={() => setIsUsersPanelOpen((prev) => !prev)}
                  className="border-b border-zinc-500 text-zinc-200 transition hover:border-zinc-200"
                >
                  {isUsersPanelOpen ? "Свернуть" : "Развернуть"}
                </button>
              </div>

              {isUsersPanelOpen ? (
                <>
                  {isUsersLoading ? <p className="mt-1 text-zinc-500">Загрузка списка пользователей...</p> : null}
                  {usersError ? <p className="mt-1 text-rose-300">{usersError}</p> : null}
                  {registeredUsers.length ? (
                    <div className="mt-2 grid gap-1 text-zinc-300 sm:grid-cols-2">
                      {registeredUsers.map((entry) => (
                        <p key={`${entry.username}:${entry.createdAtIso}`}>
                          <b className="text-zinc-100">{entry.username}</b>
                          <span className="text-zinc-500"> - </span>
                          {new Date(entry.createdAtIso).toLocaleString("ru-RU")}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Игроки</p>
            <div className="flex flex-wrap gap-2">
              {selectedNicknames.map((nickname) => (
                <span key={nickname} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-sm">
                  {nickname}
                  <button type="button" onClick={() => removePlayer(nickname)} className="text-zinc-500 transition hover:text-zinc-200" aria-label={`Удалить ${nickname}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="relative max-w-md">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchResults.length) {
                    addPlayer(searchResults[0].nickname);
                    setSearchQuery("");
                    setSearchResults([]);
                  }
                }}
                placeholder="Поиск игрока FACEIT"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
              />
              {searchResults.length > 0 ? (
                <div className="absolute z-30 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                  {searchResults.map((result) => (
                    <button
                      key={result.nickname}
                      type="button"
                      onClick={() => {
                        addPlayer(result.nickname);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-zinc-800"
                    >
                      <span className="inline-flex items-center gap-2">
                        <img src={result.avatar} alt={result.nickname} className="h-5 w-5 rounded-full object-cover" />
                        {result.nickname}
                      </span>
                      <span className="text-zinc-400">ELO {result.elo}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {isSearching ? <p className="mt-1 text-xs text-zinc-500">Ищем игроков...</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-zinc-400">Дизайн</p>
            <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-900/80 p-1 text-sm">
              {([
                ["column", "В колонну"],
                ["row", "В строку"],
                ["mini", "Мини"],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayoutMode(mode)}
                  className={`rounded px-3 py-1 transition ${layoutMode === mode ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {errorText ? <p className="text-sm text-rose-300">Ошибка загрузки: {errorText}</p> : null}

        {isInitialLoading ? (
          <div className="flex items-center gap-3 text-zinc-300">
            <span className="h-4 w-4 rounded-full border-2 border-zinc-600 border-t-zinc-100 spinner" />
            Загружаем статистику игроков...
          </div>
        ) : (
          <ul className={listClassName}>
            {visiblePlayers.map((player) => {
              const bestMapName = getBestMapName(player.maps);
              const faceitLevel = getFaceitLevel(player.elo);
              const weaponPanelOpen = expandedWeapons[player.playerId] ?? true;

              if (layoutMode === "mini") {
                return (
                  <li key={player.playerId} className="fade-in rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <a href={player.faceitUrl} target="_blank" rel="noreferrer" className="text-lg font-semibold transition hover:text-orange-300">
                        {player.nickname}
                      </a>
                      <span className={`text-2xl font-black ${player.elo < 2000 ? "text-orange-500" : "text-red-500"}`}>{player.elo}</span>
                    </div>
                    <p className="text-xs text-zinc-500">Level {faceitLevel}</p>
                    <p className="mt-2 text-sm text-zinc-300">
                      K/D <b className="text-zinc-100">{formatStatNumber(player.kd)}</b> | AVG <b className="text-zinc-100">{formatStatNumber(player.avg, 0)}</b>
                    </p>
                    <p className="mt-1 text-sm text-zinc-300">{renderLastMatchLine(player.lastMatch)}</p>
                  </li>
                );
              }

              return (
                <li key={player.playerId} className={`fade-in ${layoutMode === "row" ? "rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4" : "py-6 sm:py-8"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <img src={player.avatar} alt={player.nickname} className="h-14 w-14 rounded-full border border-zinc-700 object-cover" />
                      <div>
                        <a href={player.faceitUrl} target="_blank" rel="noreferrer" className="text-xl font-semibold tracking-tight transition hover:text-orange-300">
                          {player.nickname}
                        </a>
                        {player.hasPremium ? <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-yellow-300">Premium</span> : null}
                        <p className="mt-1 text-sm">
                          {player.activity.inMatch && player.activity.matchUrl ? (
                            <a href={player.activity.matchUrl} target="_blank" rel="noreferrer" className="text-orange-400 transition hover:text-orange-300">
                              В матче
                            </a>
                          ) : (
                            <span className="text-zinc-500">Не активен</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={`text-3xl leading-none font-black sm:text-4xl ${player.elo < 2000 ? "text-orange-500" : "text-red-500"}`}>{player.elo}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">level {faceitLevel}</p>
                      </div>
                      <LevelIcon level={faceitLevel} className="h-12 w-12 shrink-0 -translate-y-1 sm:h-14 sm:w-14 sm:-translate-y-1.5" />
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

                  <p className="mb-4 text-sm text-zinc-300">
                    {renderLastMatchLine(player.lastMatch)}
                    {player.lastMatch ? (
                      <>
                        <span className="text-zinc-500"> | </span>
                        <a href={player.lastMatch.matchUrl} target="_blank" rel="noreferrer" className="text-zinc-200 transition hover:text-orange-300">
                          открыть матч
                        </a>
                      </>
                    ) : null}
                  </p>

                  <div className="space-y-2 text-zinc-300">
                    <StatColumn label="За день" value={player.day} />
                    <StatColumn label="За месяц" value={player.month} />
                    <StatColumn label="За всё время" value={player.total} />
                  </div>

                  <div className="mt-4 rounded-md border border-zinc-800/80 bg-zinc-900/30 p-3 text-sm text-zinc-300">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-zinc-400">Оружие</p>
                      <button
                        type="button"
                        onClick={() => toggleWeaponPanel(player.playerId)}
                        className="border-b border-zinc-600 text-xs uppercase tracking-wide text-zinc-200 transition hover:border-zinc-300"
                      >
                        {weaponPanelOpen ? "Свернуть" : "Развернуть"}
                      </button>
                    </div>

                    <div className={`grid transition-all duration-300 ${weaponPanelOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                      <div className="overflow-hidden">
                        {player.favoriteWeapon ? (
                          <p className="text-zinc-200">
                            Любимое оружие: <b className="text-orange-300">{player.favoriteWeapon.weapon}</b>
                          </p>
                        ) : (
                          <p className="text-zinc-500">Нет данных по оружию.</p>
                        )}

                        {player.weapons.length ? (
                          <div className="mt-2 space-y-1 text-xs sm:text-sm">
                            {player.weapons.map((entry) => (
                              <p key={`${player.playerId}:weapon:${entry.weapon}`}>
                                <b className="text-zinc-100">{entry.weapon}</b>
                                <span className="text-zinc-500"> | </span>
                                Попадания <b className={entry.hitRate >= 50 ? "text-emerald-300" : "text-rose-300"}>{formatStatNumber(entry.hitRate, 1)}%</b>
                                <span className="text-zinc-500"> | </span>
                                AVG киллы <b className="text-zinc-100">{formatStatNumber(entry.avgKills, 1)}</b>
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-zinc-300">
                    <p className="mb-2 text-zinc-400">Матчи по картам</p>
                    {player.maps.length ? (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {player.maps.map((entry) => {
                            const mapKey = `${player.playerId}:${entry.map}`;
                            const expanded = Boolean(expandedMaps[mapKey]);
                            return (
                              <div key={mapKey} className="rounded-md border border-zinc-800/80 p-2">
                                <p className="font-medium text-zinc-100">{entry.map}</p>
                                <button
                                  type="button"
                                  onClick={() => toggleMapPanel(player.playerId, entry.map)}
                                  className="mt-2 block w-full overflow-hidden rounded-md border border-zinc-700/70"
                                >
                                  <img src={mapPreviewUri(entry.map)} alt={`Карта ${entry.map}`} className="h-20 w-full object-cover transition duration-300 hover:scale-[1.03]" />
                                </button>
                                <p className="mt-2 text-xs">
                                  Матчи <b className="text-zinc-100">{entry.matches}</b>
                                  <span className="text-zinc-500"> | WR </span>
                                  <b className={entry.winRate < 50 ? "text-rose-400" : "text-emerald-300"}>{formatStatNumber(entry.winRate, 1)}%</b>
                                </p>

                                <div
                                  className={`grid transition-all duration-300 ${expanded ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                                >
                                  <div className="overflow-hidden text-xs text-zinc-300">
                                    W/L <b className="text-emerald-300">{entry.wins}</b>
                                    <span className="text-zinc-500">/</span>
                                    <b className="text-rose-300">{entry.losses}</b>
                                    <span className="text-zinc-500"> | </span>
                                    K/D <b className="text-zinc-100">{formatStatNumber(entry.kd)}</b>
                                    <span className="text-zinc-500"> | </span>
                                    AVG <b className="text-zinc-100">{formatStatNumber(entry.avgKills, 1)}</b>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {bestMapName ? (
                          <p className="mt-2 text-yellow-300">
                            best map: <b>{bestMapName}</b>
                          </p>
                        ) : null}
                      </>
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