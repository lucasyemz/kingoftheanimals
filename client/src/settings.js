// Preferências do jogador, guardadas no navegador: volume, mudo, qualidade gráfica,
// estatísticas e se já fez o tutorial.

const KEY = 'kota.settings';
const STATS_KEY = 'kota.stats';

const DEFAULTS = {
  music: 0.7,       // 0..1
  sfx: 0.8,         // 0..1
  muted: false,
  graphics: 'auto', // 'auto' | 'high' | 'low'  (auto = leve no celular)
  tutorialDone: false,
};

function read(key, defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings = read(KEY, DEFAULTS);

export function saveSettings(patch) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
}

// ---------- Moedas e chapéus ----------

const WALLET_KEY = 'kota.wallet';
export const wallet = read(WALLET_KEY, { coins: 0, owned: ['none'], hat: 'none' });

function saveWallet() {
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
}

export function addCoins(n) {
  wallet.coins += n;
  saveWallet();
}

// Compra (se não tem) e veste. Retorna false se faltam moedas.
export function equipHat(id, price) {
  if (!wallet.owned.includes(id)) {
    if (wallet.coins < price) return false;
    wallet.coins -= price;
    wallet.owned.push(id);
  }
  wallet.hat = id;
  saveWallet();
  return true;
}

// ---------- Estatísticas ----------

const STATS_DEFAULTS = { matches: 0, matchWins: 0, rounds: 0, roundWins: 0, kos: 0, falls: 0, bestStreak: 0, xp: 0 };

export const stats = read(STATS_KEY, STATS_DEFAULTS);

export function addStats(patch) {
  for (const [k, v] of Object.entries(patch)) {
    stats[k] = k === 'bestStreak' ? Math.max(stats[k] ?? 0, v) : (stats[k] ?? 0) + v;
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

// ---------- Nível (XP) ----------
// Nível n precisa de 100 + 50 × (n − 1) XP para passar ao próximo.

export const XP = { ROUND: 10, ROUND_WIN: 30, KO: 8, QUALIFY: 20, MATCH: 20, MATCH_WIN: 60, MISSION: 40 };

export function levelOf(xp) {
  let level = 1;
  let need = 100;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level += 1;
    need = 100 + 50 * (level - 1);
  }
  return { level, into: rest, need };
}

export function addXp(n) {
  const before = levelOf(stats.xp ?? 0).level;
  stats.xp = (stats.xp ?? 0) + n;
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  return levelOf(stats.xp).level > before; // subiu de nível?
}

// ---------- Missões diárias ----------
// Três por dia, sorteadas pela data (todo mundo recebe as mesmas no mesmo dia).

export const MISSION_POOL = [
  { id: 'kos5', stat: 'kos', goal: 5, reward: 40 },
  { id: 'kos12', stat: 'kos', goal: 12, reward: 80 },
  { id: 'wins2', stat: 'roundWins', goal: 2, reward: 50 },
  { id: 'matches3', stat: 'matches', goal: 3, reward: 40 },
  { id: 'jumps30', stat: 'jumps', goal: 30, reward: 25 },
  { id: 'ballsWin', stat: 'win:balls', goal: 1, reward: 50 },
  { id: 'hexWin', stat: 'win:hex', goal: 1, reward: 50 },
  { id: 'ropeWin', stat: 'win:jumprope', goal: 1, reward: 50 },
  { id: 'hillWin', stat: 'win:hill', goal: 1, reward: 50 },
  { id: 'potatoWin', stat: 'win:potato', goal: 1, reward: 50 },
  { id: 'qualify2', stat: 'qualify', goal: 2, reward: 45 },
  { id: 'party1', stat: 'party', goal: 1, reward: 30 },
];

const MISSIONS_KEY = 'kota.missions';
const today = () => new Date().toISOString().slice(0, 10);

function dailyPicks(day) {
  let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pool = [...MISSION_POOL];
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export function missions() {
  let m = read(MISSIONS_KEY, { day: '', progress: {}, done: [] });
  if (m.day !== today()) m = { day: today(), progress: {}, done: [] };
  return {
    ...m,
    list: dailyPicks(m.day).map((def) => ({ ...def, have: Math.min(def.goal, m.progress[def.stat] ?? 0), done: m.done.includes(def.id) })),
  };
}

// Conta um evento (ex.: 'kos', 'win:balls'). Retorna as missões que acabaram de ser cumpridas.
export function trackMission(stat, n = 1) {
  const m = missions();
  const state = { day: m.day, progress: { ...m.progress }, done: [...m.done] };
  if (!m.list.some((x) => x.stat === stat)) return [];
  state.progress[stat] = (state.progress[stat] ?? 0) + n;
  const finished = m.list.filter((x) => !x.done && state.progress[stat] >= x.goal && x.stat === stat);
  for (const f of finished) state.done.push(f.id);
  localStorage.setItem(MISSIONS_KEY, JSON.stringify(state));
  return finished;
}
