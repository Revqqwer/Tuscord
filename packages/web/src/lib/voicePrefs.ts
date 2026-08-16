/**
 * Kişisel ses karıştırma tercihleri — kanal/kullanıcı ses seviyesi ve
 * sessize alınan kişiler. Sunucuya YAZILMAZ, yalnızca bu cihazda geçerli
 * (Discord'un "User Volume" özelliği de böyle davranır).
 *
 * Tek bir JSON blob olarak saklanıyor (kullanıcı/kanal başına ayrı anahtar
 * yerine) — potansiyel olarak yüzlerce kanal/kullanıcı için ayrı
 * localStorage anahtarı açmak yerine tek okuma/yazma.
 */

const STORAGE_KEY = 'tuscord.voicePrefs';

interface StoredPrefs {
  channelVolumes: Record<string, number>;
  userVolumes: Record<string, number>;
  mutedPeerIds: string[];
}

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { channelVolumes: {}, userVolumes: {}, mutedPeerIds: [] };
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return {
      channelVolumes: parsed.channelVolumes ?? {},
      userVolumes: parsed.userVolumes ?? {},
      mutedPeerIds: parsed.mutedPeerIds ?? [],
    };
  } catch {
    return { channelVolumes: {}, userVolumes: {}, mutedPeerIds: [] };
  }
}

export function loadChannelVolumes(): Map<string, number> {
  return new Map(Object.entries(load().channelVolumes));
}

export function loadUserVolumes(): Map<string, number> {
  return new Map(Object.entries(load().userVolumes));
}

export function loadMutedPeerIds(): Set<string> {
  return new Set(load().mutedPeerIds);
}

export function saveChannelVolumes(map: ReadonlyMap<string, number>): void {
  const current = load();
  current.channelVolumes = Object.fromEntries(map);
  persist(current);
}

export function saveUserVolumes(map: ReadonlyMap<string, number>): void {
  const current = load();
  current.userVolumes = Object.fromEntries(map);
  persist(current);
}

export function saveMutedPeerIds(set: ReadonlySet<string>): void {
  const current = load();
  current.mutedPeerIds = [...set];
  persist(current);
}

function persist(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Gizli mod / kota dolu — sessizce geç, tercih bu oturumda bellekte kalır.
  }
}
