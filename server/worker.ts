const FACEIT_API_BASE_URL = "https://open.faceit.com/data/v4";
const GAME_ID = "cs2";
const GAME_MODE = "5v5";
const AVG_SAMPLE_SIZE = 30;
const HISTORY_LIMIT = 100;
const CACHE_TTL_MS = 300_000;
const PLAYER_CACHE_TTL_MS = 120_000;
const DEFAULT_PLAYER_NICKNAMES = ["mazedaddy", "SEXN", "unborrasq"];
const MOSCOW_UTC_OFFSET_HOURS = 3;
const FALLBACK_AVATAR = "https://cdn-frontend.faceit-cdn.net/web/300/src/app/assets/images/no-avatar.jpg";
const ADMIN_USERNAME_NORMALIZED = "maze";
const KNOWN_WEAPON_LABELS = new Set([
  "ak47",
  "m4a1s",
  "m4a4",
  "awp",
  "deagle",
  "deserteagle",
  "usp",
  "usps",
  "glock",
  "famas",
  "galil",
  "mp9",
  "mac10",
  "mp7",
  "ump45",
  "p90",
  "bizon",
  "xm1014",
  "mag7",
  "nova",
  "ssg08",
  "scar20",
  "g3sg1",
  "tec9",
  "five7",
  "p250",
  "cz75",
  "zeus",
  "hegrenade",
  "molotov",
  "incgrenade",
  "smokegrenade",
  "flashbang",
  "knife",
  "pistol",
  "pistols",
  "rifle",
  "rifles",
  "smg",
  "sniper",
  "snipers",
  "heavy",
  "grenade",
  "grenades",
]);

const NON_WEAPON_TOKENS = new Set([
  "all",
  "overall",
  "total",
  "totals",
  "average",
  "avg",
  "last",
  "recent",
  "wins",
  "losses",
  "win",
  "loss",
  "matches",
  "games",
  "headshot",
  "headshots",
  "accuracy",
  "hitrate",
  "kdratio",
  "kills",
  "deaths",
  "assist",
  "assists",
]);

const WEAPON_ALIASES: Record<string, string> = {
  deserteagle: "deagle",
  usps: "usp",
  usp: "usp",
  m4a1: "m4a1s",
  m4a1s: "m4a1s",
  mp5sd: "mp7",
  he: "hegrenade",
  incendiary: "incgrenade",
  incendiarygrenade: "incgrenade",
  smoke: "smokegrenade",
  flash: "flashbang",
};

const WEAPON_DISPLAY_NAMES: Record<string, string> = {
  ak47: "AK-47",
  m4a1s: "M4A1-S",
  m4a4: "M4A4",
  awp: "AWP",
  deagle: "Desert Eagle",
  usp: "USP-S",
  glock: "Glock-18",
  famas: "FAMAS",
  galil: "Galil AR",
  mp9: "MP9",
  mac10: "MAC-10",
  mp7: "MP7",
  ump45: "UMP-45",
  p90: "P90",
  bizon: "PP-Bizon",
  xm1014: "XM1014",
  mag7: "MAG-7",
  nova: "Nova",
  ssg08: "SSG 08",
  scar20: "SCAR-20",
  g3sg1: "G3SG1",
  tec9: "Tec-9",
  five7: "Five-SeveN",
  p250: "P250",
  cz75: "CZ75-Auto",
  zeus: "Zeus x27",
  hegrenade: "HE Grenade",
  molotov: "Molotov",
  incgrenade: "Incendiary",
  smokegrenade: "Smoke",
  flashbang: "Flashbang",
  knife: "Knife",
  pistol: "Pistols",
  rifle: "Rifles",
  smg: "SMG",
  sniper: "Snipers",
  heavy: "Heavy",
  grenade: "Grenades",
};

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

type WeaponStats = {
  weapon: string;
  matches: number;
  kills: number;
  hitRate: number;
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
  weapons: WeaponStats[];
  favoriteWeapon: WeaponStats | null;
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

type NormalizedSearchInput = {
  original: string;
  query: string;
  faceitNickname?: string;
  steamId64?: string;
  steamVanity?: string;
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
  AUTH_PEPPER?: string;
  AUTH_STORE?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list?: (options?: { prefix?: string; cursor?: string; limit?: number }) => Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  };
};

type AuthUserRecord = {
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  salt: string;
  createdAtIso: string;
};

type AuthSessionRecord = {
  tokenHash: string;
  username: string;
  usernameNormalized: string;
  expiresAt: number;
};

let memoryCache: { expiresAt: number; payload: ApiStatsResponse } | null = null;
let lastSuccessfulPayload: ApiStatsResponse | null = null;
const playerMemoryCache = new Map<string, { expiresAt: number; payload: PlayerViewModel }>();
const memoryUsers = new Map<string, AuthUserRecord>();
const memorySessions = new Map<string, AuthSessionRecord>();
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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

function normalizeWeaponName(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "Unknown";
  }

  const cleaned = raw.replace(/^weapon[_\s-]*/i, "").replace(/_/g, " ").trim();
  if (!cleaned) {
    return "Unknown";
  }

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isLikelyWeaponToken(value: string): boolean {
  if (!value || value.length < 2) {
    return false;
  }
  if (NON_WEAPON_TOKENS.has(value)) {
    return false;
  }

  // Reject common map names so map segments are not misclassified as weapons.
  if (["mirage", "inferno", "nuke", "anubis", "ancient", "dust2", "vertigo", "train", "overpass"].includes(value)) {
    return false;
  }

  if (KNOWN_WEAPON_LABELS.has(value)) {
    return true;
  }

  return /^(ak|m4|awp|usp|glock|deagle|famas|galil|mp|p90|ssg|scar|g3|tec|five|p250|cz|knife|smoke|flash|molo|nova|xm|rifle|pistol|smg|sniper|heavy|grenade)/.test(value);
}

function resolveWeaponToken(value: unknown): string {
  const rawToken = normalizeToken(value);
  if (!rawToken) {
    return "";
  }

  const directAlias = WEAPON_ALIASES[rawToken];
  if (directAlias) {
    return directAlias;
  }

  if (KNOWN_WEAPON_LABELS.has(rawToken)) {
    return rawToken;
  }

  const trimmedWeaponPrefix = rawToken.replace(/^weapon/, "");
  const aliasFromTrimmed = WEAPON_ALIASES[trimmedWeaponPrefix];
  if (aliasFromTrimmed) {
    return aliasFromTrimmed;
  }
  if (KNOWN_WEAPON_LABELS.has(trimmedWeaponPrefix)) {
    return trimmedWeaponPrefix;
  }

  if (isLikelyWeaponToken(trimmedWeaponPrefix)) {
    return trimmedWeaponPrefix;
  }

  if (isLikelyWeaponToken(rawToken)) {
    return rawToken;
  }

  return "";
}

function weaponLabelFromToken(token: string): string {
  return WEAPON_DISPLAY_NAMES[token] ?? normalizeWeaponName(token);
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
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }

  const normalized = raw.replace(/\s/g, "").replace(/,/g, "");
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  // Fallback for values mixed with labels like "123 matches".
  const decimalFallback = parseDecimal(raw);
  return Number.isFinite(decimalFallback) ? decimalFallback : 0;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(digest);
}

function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function validateUsername(value: string): string | null {
  if (value.length < 3 || value.length > 24) {
    return "Логин должен быть длиной от 3 до 24 символов";
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return "Логин может содержать только буквы, цифры, точку, дефис и _";
  }
  return null;
}

function validatePassword(value: string): string | null {
  if (value.length < 6 || value.length > 72) {
    return "Пароль должен быть длиной от 6 до 72 символов";
  }
  return null;
}

async function hashPassword(password: string, salt: string, env: Env): Promise<string> {
  const encoder = new TextEncoder();
  const pepper = String(env.AUTH_PEPPER ?? "");
  const key = await crypto.subtle.importKey("raw", encoder.encode(`${password}:${pepper}`), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      // Cloudflare Workers PBKDF2 limit is 100000 iterations.
      iterations: 100_000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return toHex(bits);
}

async function hashSessionToken(token: string, env: Env): Promise<string> {
  const pepper = String(env.AUTH_PEPPER ?? "");
  return sha256Hex(`${token}:${pepper}`);
}

function hasAuthPersistenceConfigured(env: Env): boolean {
  return Boolean(env.AUTH_STORE && env.AUTH_PEPPER);
}

function createRandomToken(bytes = 32): string {
  const source = crypto.getRandomValues(new Uint8Array(bytes));
  const binary = String.fromCharCode(...source);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getAuthUser(normalizedUsername: string, env: Env): Promise<AuthUserRecord | null> {
  if (!normalizedUsername) {
    return null;
  }

  if (env.AUTH_STORE) {
    const raw = await env.AUTH_STORE.get(`user:${normalizedUsername}`);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AuthUserRecord;
    } catch {
      return null;
    }
  }

  return memoryUsers.get(normalizedUsername) ?? null;
}

async function putAuthUser(user: AuthUserRecord, env: Env): Promise<void> {
  const key = `user:${user.usernameNormalized}`;
  if (env.AUTH_STORE) {
    await env.AUTH_STORE.put(key, JSON.stringify(user));
    return;
  }
  memoryUsers.set(user.usernameNormalized, user);
}

async function getAuthSession(token: string, env: Env): Promise<AuthSessionRecord | null> {
  if (!token) {
    return null;
  }

  if (env.AUTH_STORE) {
    const raw = await env.AUTH_STORE.get(`session:${token}`);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AuthSessionRecord;
    } catch {
      return null;
    }
  }

  return memorySessions.get(token) ?? null;
}

async function putAuthSession(session: AuthSessionRecord, env: Env): Promise<void> {
  const key = `session:${session.tokenHash}`;
  if (env.AUTH_STORE) {
    await env.AUTH_STORE.put(key, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
    return;
  }
  memorySessions.set(session.tokenHash, session);
}

async function deleteAuthSession(token: string, env: Env): Promise<void> {
  if (!token) {
    return;
  }

  if (env.AUTH_STORE) {
    await env.AUTH_STORE.delete(`session:${token}`);
    return;
  }
  memorySessions.delete(token);
}

function readBearerToken(request: Request): string {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

async function requireAuth(request: Request, env: Env): Promise<AuthSessionRecord | null> {
  if (!hasAuthPersistenceConfigured(env)) {
    return null;
  }

  const token = readBearerToken(request);
  if (!token) {
    return null;
  }

  const tokenHash = await hashSessionToken(token, env);

  const session = await getAuthSession(tokenHash, env);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    await deleteAuthSession(tokenHash, env);
    return null;
  }

  return session;
}

function isAdminSession(session: AuthSessionRecord | null): boolean {
  if (!session) {
    return false;
  }
  return normalizeUsername(session.username) === ADMIN_USERNAME_NORMALIZED;
}

async function registerUser(request: Request, env: Env): Promise<Response> {
  if (!hasAuthPersistenceConfigured(env)) {
    return json({ error: "Auth storage is not configured on server" }, { status: 500 });
  }

  let payload: { username?: string; password?: string };
  try {
    payload = (await request.json()) as { username?: string; password?: string };
  } catch {
    return json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "");
  const usernameError = validateUsername(username);
  if (usernameError) {
    return json({ error: usernameError }, { status: 400 });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return json({ error: passwordError }, { status: 400 });
  }

  const usernameNormalized = normalizeUsername(username);
  const existing = await getAuthUser(usernameNormalized, env);
  if (existing) {
    return json({ error: "Такой логин уже существует" }, { status: 409 });
  }

  const salt = createRandomToken(16);
  const passwordHash = await hashPassword(password, salt, env);
  const user: AuthUserRecord = {
    username,
    usernameNormalized,
    passwordHash,
    salt,
    createdAtIso: new Date().toISOString(),
  };

  await putAuthUser(user, env);

  // Create session right away so UI can complete registration without a second
  // immediate KV read (which can be eventually consistent across PoPs).
  const token = createRandomToken(32);
  const tokenHash = await hashSessionToken(token, env);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const session: AuthSessionRecord = {
    tokenHash,
    username: user.username,
    usernameNormalized: user.usernameNormalized,
    expiresAt,
  };
  await putAuthSession(session, env);

  return json({
    ok: true,
    username: user.username,
    token,
    expiresAtIso: new Date(expiresAt).toISOString(),
  });
}

async function loginUser(request: Request, env: Env): Promise<Response> {
  if (!hasAuthPersistenceConfigured(env)) {
    return json({ error: "Auth storage is not configured on server" }, { status: 500 });
  }

  let payload: { username?: string; password?: string };
  try {
    payload = (await request.json()) as { username?: string; password?: string };
  } catch {
    return json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "");
  const usernameNormalized = normalizeUsername(username);
  if (!usernameNormalized || !password) {
    return json({ error: "Нужны логин и пароль" }, { status: 400 });
  }

  const user = await getAuthUser(usernameNormalized, env);
  if (!user) {
    return json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const passwordHash = await hashPassword(password, user.salt, env);
  if (passwordHash !== user.passwordHash) {
    return json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const token = createRandomToken(32);
  const tokenHash = await hashSessionToken(token, env);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const session: AuthSessionRecord = {
    tokenHash,
    username: user.username,
    usernameNormalized: user.usernameNormalized,
    expiresAt,
  };
  await putAuthSession(session, env);

  return json({
    token,
    username: user.username,
    expiresAtIso: new Date(expiresAt).toISOString(),
  });
}

async function logoutUser(request: Request, env: Env): Promise<Response> {
  const token = readBearerToken(request);
  if (token) {
    const tokenHash = await hashSessionToken(token, env);
    await deleteAuthSession(tokenHash, env);
  }
  return json({ ok: true });
}

async function listAuthUsers(env: Env): Promise<Array<{ username: string; createdAtIso: string }>> {
  if (env.AUTH_STORE?.list) {
    const collected: AuthUserRecord[] = [];
    let cursor: string | undefined;

    do {
      const page = await env.AUTH_STORE.list({
        prefix: "user:",
        cursor,
        limit: 1000,
      });

      for (const key of page.keys) {
        const raw = await env.AUTH_STORE.get(key.name);
        if (!raw) {
          continue;
        }

        try {
          const parsed = JSON.parse(raw) as AuthUserRecord;
          if (parsed.username && parsed.createdAtIso) {
            collected.push(parsed);
          }
        } catch {
          // Ignore malformed user record.
        }
      }

      cursor = page.cursor;
      if (page.list_complete) {
        break;
      }
    } while (cursor);

    return collected
      .map((entry) => ({ username: entry.username, createdAtIso: entry.createdAtIso }))
      .sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
  }

  return [...memoryUsers.values()]
    .map((entry) => ({ username: entry.username, createdAtIso: entry.createdAtIso }))
    .sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
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

function findValueByKeyIncludes(record: Record<string, unknown> | undefined, includes: string[]): unknown {
  if (!record) {
    return undefined;
  }

  const normalizedIncludes = includes.map((item) => normalizeToken(item)).filter(Boolean);
  if (!normalizedIncludes.length) {
    return undefined;
  }

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeToken(key);
    if (!normalizedKey) {
      continue;
    }

    if (normalizedIncludes.every((token) => normalizedKey.includes(token))) {
      return value;
    }
  }

  return undefined;
}

const KNOWN_WEAPON_TOKENS_SORTED = [...new Set([...KNOWN_WEAPON_LABELS, ...Object.keys(WEAPON_ALIASES)])].sort(
  (a, b) => b.length - a.length,
);

function findWeaponTokenInKey(normalizedKey: string): string {
  if (!normalizedKey) {
    return "";
  }

  for (const token of KNOWN_WEAPON_TOKENS_SORTED) {
    if (!normalizedKey.includes(token)) {
      continue;
    }
    const resolved = resolveWeaponToken(token);
    if (resolved) {
      return resolved;
    }
  }

  return "";
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

function extractDeathsFromMatchStats(matchStats: FaceitMatchStats | null, playerId: string): number | null {
  if (!matchStats?.rounds?.length) {
    return null;
  }

  for (const round of matchStats.rounds) {
    for (const team of round.teams ?? []) {
      for (const player of team.players ?? []) {
        if (player.player_id !== playerId) {
          continue;
        }

        const rawDeaths = findValueByKey(player.player_stats, ["Deaths", "deaths", "D", "Total Deaths", "total_deaths", "i8"]);
        const parsed = parseDecimal(rawDeaths);
        return parsed > 0 || String(rawDeaths ?? "").trim() === "0" ? parsed : null;
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

    const directWinRate = parsePercent(
      findValueByKey(segmentStats, ["Win Rate %", "Win Rate", "Winrate", "win_rate", "win_rate_pct", "win_rate_percent"]),
    );
    let wins = parseNumber(findValueByKey(segmentStats, ["Wins", "wins", "Map Wins", "map_wins"]));
    if (wins <= 0 && directWinRate > 0 && matches > 0) {
      wins = Math.round((matches * directWinRate) / 100);
    }

    let losses = parseNumber(findValueByKey(segmentStats, ["Losses", "losses", "Map Losses", "map_losses"]));
    if (losses <= 0) {
      losses = Math.max(matches - wins, 0);
    }

    const computedWinRate = matches > 0 ? (wins / matches) * 100 : 0;
    const winRate = Math.max(0, Math.min(100, directWinRate > 0 ? directWinRate : computedWinRate));

    let kd = parseDecimal(
      findValueByKey(segmentStats, [
        "Average K/D Ratio",
        "Average KD Ratio",
        "Average K/D",
        "K/D Ratio",
        "K/D",
        "KD Ratio",
        "kdr",
        "avg_kd",
      ]),
    );

    const totalKills = parseDecimal(
      findValueByKey(segmentStats, ["Kills", "kills", "Total Kills", "total_kills", "Total K" ]),
    );
    const totalDeaths = parseDecimal(
      findValueByKey(segmentStats, ["Deaths", "deaths", "Total Deaths", "total_deaths", "Total D"]),
    );

    if (kd <= 0 && totalKills > 0 && totalDeaths > 0) {
      kd = totalKills / totalDeaths;
    }

    let avgKills = parseDecimal(
      findValueByKey(segmentStats, [
        "Average Kills",
        "Average Kills per Match",
        "Avg Kills",
        "average_kills",
        "avg_kills",
      ]),
    );
    if (avgKills <= 0 && totalKills > 0 && matches > 0) {
      avgKills = totalKills / matches;
    }

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

function isWeaponSegment(segment: { label?: string; type?: string; mode?: string } | undefined): boolean {
  const label = String(segment?.label ?? "").trim();
  if (!label || /^overall$/i.test(label)) {
    return false;
  }

  const typeToken = normalizeToken(segment?.type);
  const modeToken = normalizeToken(segment?.mode);
  if (typeToken.includes("weapon") || modeToken.includes("weapon")) {
    return true;
  }

  const normalizedLabel = normalizeToken(label);
  if (KNOWN_WEAPON_LABELS.has(normalizedLabel)) {
    return true;
  }

  // Fallback heuristic for weapon-like labels.
  return /^(ak|m4|awp|usp|glock|deagle|famas|galil|mp|p90|ssg|scar|g3|tec|five|p250|cz|knife|smoke|flash|molotov|nova|xm)/i.test(label);
}

function mergeWeaponAggregate(
  byWeapon: Map<
    string,
    {
      matches: number;
      kills: number;
      weightedHitRate: number;
      hitWeight: number;
      weightedAvgKills: number;
      avgWeight: number;
    }
  >,
  weaponLabel: string,
  matches: number,
  kills: number,
  hitRate: number,
  avgKills: number,
): void {
  const safeMatches = Math.max(matches, 0);
  const safeKills = Math.max(kills, 0);
  const safeHitRate = Math.max(hitRate, 0);
  const safeAvgKills = Math.max(avgKills, 0);
  const hitWeight = Math.max(safeKills, safeMatches, 1);
  const avgWeight = Math.max(safeMatches, 1);
  const prev = byWeapon.get(weaponLabel);

  if (!prev) {
    byWeapon.set(weaponLabel, {
      matches: safeMatches,
      kills: safeKills,
      weightedHitRate: safeHitRate * hitWeight,
      hitWeight,
      weightedAvgKills: safeAvgKills * avgWeight,
      avgWeight,
    });
    return;
  }

  byWeapon.set(weaponLabel, {
    matches: prev.matches + safeMatches,
    kills: prev.kills + safeKills,
    weightedHitRate: prev.weightedHitRate + safeHitRate * hitWeight,
    hitWeight: prev.hitWeight + hitWeight,
    weightedAvgKills: prev.weightedAvgKills + safeAvgKills * avgWeight,
    avgWeight: prev.avgWeight + avgWeight,
  });
}

function collectWeaponStatsFromLifetime(
  lifetime: Record<string, unknown> | undefined,
  byWeapon: Map<
    string,
    {
      matches: number;
      kills: number;
      weightedHitRate: number;
      hitWeight: number;
      weightedAvgKills: number;
      avgWeight: number;
    }
  >,
): void {
  if (!lifetime) {
    return;
  }

  const temporary = new Map<string, { matches: number; kills: number; hitRate: number; avgKills: number }>();

  const upsert = (token: string, patch: Partial<{ matches: number; kills: number; hitRate: number; avgKills: number }>) => {
    const prev = temporary.get(token) ?? { matches: 0, kills: 0, hitRate: 0, avgKills: 0 };
    temporary.set(token, {
      matches: patch.matches ?? prev.matches,
      kills: patch.kills ?? prev.kills,
      hitRate: patch.hitRate ?? prev.hitRate,
      avgKills: patch.avgKills ?? prev.avgKills,
    });
  };

  for (const [key, value] of Object.entries(lifetime)) {
    const normalizedKey = normalizeToken(key);
    if (!normalizedKey) {
      continue;
    }

    let weaponToken = resolveWeaponToken(normalizedKey);
    if (!weaponToken) {
      weaponToken = findWeaponTokenInKey(normalizedKey);
    }
    if (!weaponToken) {
      continue;
    }

    const isAvgKey =
      (normalizedKey.includes("avg") || normalizedKey.includes("average") || normalizedKey.includes("permatch")) &&
      (normalizedKey.includes("kill") || normalizedKey.includes("frag"));
    const isHitRateKey =
      normalizedKey.includes("accuracy") ||
      normalizedKey.includes("hitrate") ||
      normalizedKey.includes("headshotpercent") ||
      normalizedKey.includes("hspercent");
    const isMatchesKey = normalizedKey.includes("match") || normalizedKey.includes("game") || normalizedKey.includes("played");
    const isKillsKey = (normalizedKey.includes("kill") || normalizedKey.includes("frag")) && !isAvgKey;

    if (isAvgKey) {
      const parsed = parseDecimal(value);
      if (parsed > 0) {
        upsert(weaponToken, { avgKills: parsed });
      }
      continue;
    }

    if (isHitRateKey) {
      const parsed = parsePercent(value);
      if (parsed > 0) {
        upsert(weaponToken, { hitRate: parsed });
      }
      continue;
    }

    if (isMatchesKey) {
      const parsed = parseNumber(value);
      if (parsed > 0) {
        upsert(weaponToken, { matches: parsed });
      }
      continue;
    }

    if (isKillsKey) {
      const parsed = parseDecimal(value);
      if (parsed > 0) {
        upsert(weaponToken, { kills: parsed });
      }
    }
  }

  for (const [token, row] of temporary.entries()) {
    if (row.avgKills <= 0 && row.kills > 0 && row.matches > 0) {
      row.avgKills = row.kills / row.matches;
    }
    if (row.kills <= 0 && row.hitRate <= 0 && row.avgKills <= 0) {
      continue;
    }
    mergeWeaponAggregate(byWeapon, weaponLabelFromToken(token), row.matches, row.kills, row.hitRate, row.avgKills);
  }
}

function extractWeaponStats(stats: FaceitPlayerStats): { weapons: WeaponStats[]; favoriteWeapon: WeaponStats | null } {
  const byWeapon = new Map<
    string,
    {
      matches: number;
      kills: number;
      weightedHitRate: number;
      hitWeight: number;
      weightedAvgKills: number;
      avgWeight: number;
    }
  >();

  for (const segment of stats.segments ?? []) {
    if (!isWeaponSegment(segment)) {
      continue;
    }

    const segmentStats = segment.stats;
    const matches = parseNumber(
      findValueByKey(segmentStats, ["Matches", "matches", "Games", "games"]) ??
        findValueByKeyIncludes(segmentStats, ["match"]),
    );
    const kills = parseDecimal(
      findValueByKey(segmentStats, ["Kills", "kills", "Total Kills", "total_kills", "Weapon Kills", "weapon_kills"]) ??
        findValueByKeyIncludes(segmentStats, ["kill"]),
    );
    const hitRate = parsePercent(
      findValueByKey(segmentStats, [
        "Accuracy %",
        "Accuracy",
        "Hit Rate %",
        "Hit Rate",
        "Hits %",
        "hits_percent",
        "Headshots %",
        "HS %",
      ]) ??
        findValueByKeyIncludes(segmentStats, ["accuracy"]) ??
        findValueByKeyIncludes(segmentStats, ["hitrate"]),
    );

    let avgKills = parseDecimal(
      findValueByKey(segmentStats, ["Average Kills", "Average Kills per Match", "Avg Kills", "average_kills", "avg_kills"]) ??
        findValueByKeyIncludes(segmentStats, ["avg", "kill"]) ??
        findValueByKeyIncludes(segmentStats, ["average", "kill"]),
    );
    if (avgKills <= 0 && kills > 0 && matches > 0) {
      avgKills = kills / matches;
    }

    if (kills <= 0 && avgKills <= 0 && hitRate <= 0) {
      continue;
    }

    const segmentToken = resolveWeaponToken(segment.label);
    const weapon = segmentToken ? weaponLabelFromToken(segmentToken) : normalizeWeaponName(segment.label);
    mergeWeaponAggregate(byWeapon, weapon, matches, kills, hitRate, avgKills);
  }

  // FACEIT can return weapon stats in lifetime keys instead of dedicated segments.
  // Merge those keys to avoid empty weapon panels for players with valid stats.
  collectWeaponStatsFromLifetime(stats.lifetime, byWeapon);

  const weapons = [...byWeapon.entries()]
    .map(([weapon, value]) => ({
      weapon,
      matches: Math.round(value.matches),
      kills: Math.round(value.kills),
      hitRate: Number((value.weightedHitRate / Math.max(value.hitWeight, 1)).toFixed(1)),
      avgKills: Number((value.weightedAvgKills / Math.max(value.avgWeight, 1)).toFixed(1)),
    }))
    .filter((entry) => entry.weapon.trim().length > 0 && !/^unknown$/i.test(entry.weapon))
    .sort((a, b) => b.kills - a.kills || b.avgKills - a.avgKills || a.weapon.localeCompare(b.weapon))
    .slice(0, 6);

  return {
    weapons,
    favoriteWeapon: weapons.find((entry) => entry.weapon.trim().length > 0) ?? null,
  };
}

function mergeStatsSourcesForWeapons(primary: FaceitPlayerStats, secondary: FaceitPlayerStats | null): FaceitPlayerStats {
  if (!secondary) {
    return primary;
  }

  return {
    lifetime: {
      ...(secondary.lifetime ?? {}),
      ...(primary.lifetime ?? {}),
    },
    segments: [...(primary.segments ?? []), ...(secondary.segments ?? [])],
  };
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

async function extractLastFinishedMatch(history: PlayerMatch[], playerId: string, env: Env): Promise<LastMatchInfo | null> {
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

  let kills = resolveKillsFromHistory(latest);
  let deaths = resolveDeathsFromHistory(latest);

  // History payload is inconsistent for per-match K/D, so we enrich the last match from match stats when needed.
  if (kills === null || deaths === null) {
    const matchStats = await fetchMatchStats(matchId, env);
    if (kills === null) {
      kills = extractKillsFromMatchStats(matchStats, playerId);
    }
    if (deaths === null) {
      deaths = extractDeathsFromMatchStats(matchStats, playerId);
    }
  }

  return {
    matchId,
    matchUrl: `https://www.faceit.com/ru/cs2/room/${matchId}`,
    playedAtIso: new Date(getMatchTimestamp(latest) * 1000).toISOString(),
    map: resolveMapFromHistory(latest),
    win: detectWinForPlayer(latest, playerId),
    kills,
    deaths,
  };
}

async function loadPlayerStats(nickname: string, env: Env): Promise<PlayerViewModel> {
  const key = nickname.toLowerCase();
  const cached = playerMemoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const player = await faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}`, env);
  const [statsByMode, statsAllModes, history] = await Promise.all([
    faceitFetch<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}?game_mode=${encodeURIComponent(GAME_MODE)}`, env),
    faceitFetch<FaceitPlayerStats>(`/players/${player.player_id}/stats/${GAME_ID}`, env, 1).catch(() => null),
    fetchRecentHistory(player.player_id, env),
  ]);

  const stats = statsByMode;
  const weaponStatsSource = mergeStatsSourcesForWeapons(statsByMode, statsAllModes);

  const lifetime = stats.lifetime;
  const daySource = history.filter(isMatchFromTodayMoscow);
  const monthSource = history.filter((match) => getMatchTimestamp(match) >= startOfMonthUnixMoscow());
  const [day, month, avgData, lastMatch] = await Promise.all([
    summarizeMatches(daySource, player.player_id),
    summarizeMatches(monthSource, player.player_id),
    calculateLastMatchesAvgKills(player.player_id, history, env, lifetime),
    extractLastFinishedMatch(history, player.player_id, env),
  ]);

  const kd = parseDecimal(findValueByKey(lifetime, ["Average K/D Ratio", "Average KD Ratio", "K/D Ratio", "K/D"]));
  const weaponData = extractWeaponStats(weaponStatsSource);
  const mapsByMode = extractMapStats(stats);
  const maps = mapsByMode.length ? mapsByMode : extractMapStats(weaponStatsSource);

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
    maps,
    weapons: weaponData.weapons,
    favoriteWeapon: weaponData.favoriteWeapon,
    day,
    month,
    total: extractTotalStats(lifetime),
    activity: extractActivity(history),
    lastMatch,
  };

  playerMemoryCache.set(key, {
    expiresAt: Date.now() + PLAYER_CACHE_TTL_MS,
    payload,
  });

  return payload;
}

function normalizeSearchInput(rawQuery: string): NormalizedSearchInput {
  const original = String(rawQuery ?? "").trim();
  const decoded = decodeURIComponentSafe(original);
  const input = decoded || original;

  const faceitMatch = input.match(/faceit\.com\/(?:[^/]+\/){0,3}players\/([^/?#]+)/i);
  if (faceitMatch?.[1]) {
    return {
      original,
      query: faceitMatch[1],
      faceitNickname: faceitMatch[1],
    };
  }

  const steamId64Match = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (steamId64Match?.[1]) {
    return {
      original,
      query: steamId64Match[1],
      steamId64: steamId64Match[1],
    };
  }

  const steamVanityMatch = input.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (steamVanityMatch?.[1]) {
    return {
      original,
      query: steamVanityMatch[1],
      steamVanity: steamVanityMatch[1],
    };
  }

  return {
    original,
    query: input,
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toSearchItem(player: FaceitPlayer): { nickname: string; avatar: string; elo: number } {
  return {
    nickname: String(player.nickname ?? "").trim(),
    avatar: String(player.avatar ?? FALLBACK_AVATAR),
    elo: parseNumber(player.games?.[GAME_ID]?.faceit_elo),
  };
}

async function loadPlayerByNickname(nickname: string, env: Env): Promise<FaceitPlayer | null> {
  const trimmed = String(nickname ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return await faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(trimmed)}`, env, 1);
  } catch {
    return null;
  }
}

async function loadPlayerBySteamId64(steamId64: string, env: Env): Promise<FaceitPlayer | null> {
  const trimmed = String(steamId64 ?? "").trim();
  if (!/^\d{17}$/.test(trimmed)) {
    return null;
  }

  // FACEIT supports resolving a player by game account id (Steam64 for CS2).
  try {
    return await faceitFetch<FaceitPlayer>(`/players?game=${encodeURIComponent(GAME_ID)}&game_player_id=${encodeURIComponent(trimmed)}`, env, 1);
  } catch {
    return null;
  }
}

function uniqueSearchItems(items: Array<{ nickname: string; avatar: string; elo: number }>): Array<{ nickname: string; avatar: string; elo: number }> {
  const seen = new Set<string>();
  const deduped: Array<{ nickname: string; avatar: string; elo: number }> = [];
  for (const item of items) {
    const key = item.nickname.toLowerCase();
    if (!item.nickname || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function searchPlayers(query: string, env: Env): Promise<SearchApiResponse> {
  const normalized = normalizeSearchInput(query);
  const trimmed = normalized.query.trim();
  if (trimmed.length < 2) {
    return { items: [] };
  }

  const exactCandidates: Array<{ nickname: string; avatar: string; elo: number }> = [];

  if (normalized.faceitNickname) {
    const exactByFaceitLink = await loadPlayerByNickname(normalized.faceitNickname, env);
    if (exactByFaceitLink) {
      exactCandidates.push(toSearchItem(exactByFaceitLink));
    }
  }

  if (normalized.steamId64) {
    const exactBySteam = await loadPlayerBySteamId64(normalized.steamId64, env);
    if (exactBySteam) {
      exactCandidates.push(toSearchItem(exactBySteam));
    }
  }

  // For a plain nickname or steam vanity URL token, try an exact nickname resolve first.
  if (!normalized.steamId64) {
    const exactByNickname = await loadPlayerByNickname(trimmed, env);
    if (exactByNickname) {
      exactCandidates.push(toSearchItem(exactByNickname));
    }
  }

  const params = new URLSearchParams({ nickname: trimmed, offset: "0", limit: "8" });
  const response = await faceitFetch<FaceitSearchResponse>(`/search/players?${params.toString()}`, env, 1).catch(() => ({ items: [] }));
  const fuzzyItems = (response.items ?? [])
    .map((item) => ({
      nickname: String(item.nickname ?? "").trim(),
      avatar: String(item.avatar ?? FALLBACK_AVATAR),
      elo: parseNumber(item.games?.[GAME_ID]?.faceit_elo),
    }))
    .filter((item) => item.nickname);

  const items = uniqueSearchItems([...exactCandidates, ...fuzzyItems]).slice(0, 8);

  return { items };
}

function pickCorsOrigin(request: Request, env: Env): string {
  const requestOrigin = request.headers.get("origin") ?? "";
  if (!requestOrigin) {
    return "*";
  }
  if (requestOrigin.startsWith("chrome-extension://")) {
    return requestOrigin;
  }
  if (requestOrigin === "null") {
    return "*";
  }
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const fallbackAllowed = ["https://youngmaze.github.io", "http://localhost:5173", "http://127.0.0.1:5173"];
  const allowedOrigins = configured.length ? configured : fallbackAllowed;

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Return wildcard for unknown origins to avoid browser-side fetch failures
  // when ALLOWED_ORIGINS is not configured correctly.
  return "*";
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  return {
    "access-control-allow-origin": pickCorsOrigin(request, env),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }

      if (url.pathname === "/health") {
        return json({ ok: true }, { headers });
      }

      const validPaths = new Set([
        "/api/stats",
        "/api/player-stats",
        "/api/search-players",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/me",
        "/api/auth/logout",
        "/api/auth/users",
      ]);
      if (!validPaths.has(url.pathname)) {
        return json({ error: "Not Found" }, { status: 404, headers });
      }

      if (!hasAuthPersistenceConfigured(env)) {
        return json(
          {
            error: "AUTH_STORE and AUTH_PEPPER must be configured",
          },
          { status: 500, headers },
        );
      }

      if (url.pathname === "/api/auth/register") {
        if (request.method !== "POST") {
          return json({ error: "Method Not Allowed" }, { status: 405, headers });
        }
        const response = await registerUser(request, env);
        return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
      }

      if (url.pathname === "/api/auth/login") {
        if (request.method !== "POST") {
          return json({ error: "Method Not Allowed" }, { status: 405, headers });
        }
        const response = await loginUser(request, env);
        return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
      }

      if (url.pathname === "/api/auth/me") {
        const session = await requireAuth(request, env);
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401, headers });
        }
        return json({ username: session.username, expiresAtIso: new Date(session.expiresAt).toISOString() }, { headers });
      }

      if (url.pathname === "/api/auth/logout") {
        const response = await logoutUser(request, env);
        return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
      }

      if (url.pathname === "/api/auth/users") {
        if (request.method !== "GET") {
          return json({ error: "Method Not Allowed" }, { status: 405, headers });
        }
        const session = await requireAuth(request, env);
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401, headers });
        }
        if (!isAdminSession(session)) {
          return json({ error: "Forbidden" }, { status: 403, headers });
        }

        const users = await listAuthUsers(env);
        return json({ count: users.length, users }, { headers });
      }

      const session = await requireAuth(request, env);
      if (!session) {
        return json({ error: "Unauthorized" }, { status: 401, headers });
      }

      if (!env.FACEIT_API_KEY) {
        return json({ error: "FACEIT_API_KEY is missing" }, { status: 500, headers });
      }

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