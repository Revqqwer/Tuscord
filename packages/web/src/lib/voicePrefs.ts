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
  /** 0-100 — düşük değer konuşma algısını daha KOLAY tetikler (bkz. voice.ts). */
  inputSensitivity: number;
  /** 0-100 — tüm gelen seslere uygulanan ANA çarpan (kanal/kullanıcı seviyelerinin ÜSTÜNE). */
  outputVolume: number;
  /** Varsayılan AÇIK — kullanıcı kendi ayarlarından kapatabilsin diye (bkz. kullanıcı raporu). */
  noiseSuppression: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Varsayılan KAPALI (Discord'un varsayılanı da "Ses Aktivasyonu") — kullanıcı açar. */
  pushToTalk: boolean;
  /** `KeyboardEvent.code` değeri — kullanıcı ayarlarından değiştirilebilir. */
  pushToTalkKey: string;
}

const DEFAULT_PREFS: StoredPrefs = {
  channelVolumes: {},
  userVolumes: {},
  mutedPeerIds: [],
  inputSensitivity: 50,
  outputVolume: 100,
  noiseSuppression: true,
  inputDeviceId: null,
  outputDeviceId: null,
  pushToTalk: false,
  // Sağ Ctrl: yazarken yanlışlıkla basılması zor, elin klavye üstünde
  // rahatça ulaşabileceği bir tuş — Discord topluluğunun da yaygın tercihi.
  pushToTalkKey: 'ControlRight',
};

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return {
      channelVolumes: parsed.channelVolumes ?? {},
      userVolumes: parsed.userVolumes ?? {},
      mutedPeerIds: parsed.mutedPeerIds ?? [],
      inputSensitivity: parsed.inputSensitivity ?? DEFAULT_PREFS.inputSensitivity,
      outputVolume: parsed.outputVolume ?? DEFAULT_PREFS.outputVolume,
      noiseSuppression: parsed.noiseSuppression ?? DEFAULT_PREFS.noiseSuppression,
      inputDeviceId: parsed.inputDeviceId ?? null,
      outputDeviceId: parsed.outputDeviceId ?? null,
      pushToTalk: parsed.pushToTalk ?? DEFAULT_PREFS.pushToTalk,
      pushToTalkKey: parsed.pushToTalkKey ?? DEFAULT_PREFS.pushToTalkKey,
    };
  } catch {
    return { ...DEFAULT_PREFS };
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

export function loadInputSensitivity(): number {
  return load().inputSensitivity;
}
export function saveInputSensitivity(value: number): void {
  persist({ ...load(), inputSensitivity: value });
}

export function loadOutputVolume(): number {
  return load().outputVolume;
}
export function saveOutputVolume(value: number): void {
  persist({ ...load(), outputVolume: value });
}

export function loadNoiseSuppression(): boolean {
  return load().noiseSuppression;
}
export function saveNoiseSuppression(value: boolean): void {
  persist({ ...load(), noiseSuppression: value });
}

export function loadInputDeviceId(): string | null {
  return load().inputDeviceId;
}
export function saveInputDeviceId(value: string | null): void {
  persist({ ...load(), inputDeviceId: value });
}

export function loadOutputDeviceId(): string | null {
  return load().outputDeviceId;
}
export function saveOutputDeviceId(value: string | null): void {
  persist({ ...load(), outputDeviceId: value });
}

export function loadPushToTalk(): boolean {
  return load().pushToTalk;
}
export function savePushToTalk(value: boolean): void {
  persist({ ...load(), pushToTalk: value });
}

export function loadPushToTalkKey(): string {
  return load().pushToTalkKey;
}
export function savePushToTalkKey(value: string): void {
  persist({ ...load(), pushToTalkKey: value });
}

function persist(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Gizli mod / kota dolu — sessizce geç, tercih bu oturumda bellekte kalır.
  }
}
