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

const STATS_DEFAULTS = { matches: 0, matchWins: 0, rounds: 0, roundWins: 0, kos: 0, falls: 0, bestStreak: 0 };

export const stats = read(STATS_KEY, STATS_DEFAULTS);

export function addStats(patch) {
  for (const [k, v] of Object.entries(patch)) {
    stats[k] = k === 'bestStreak' ? Math.max(stats[k] ?? 0, v) : (stats[k] ?? 0) + v;
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
