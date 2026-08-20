/**
 * Kendi profil/ayarlar modalı.
 *
 * Avatar, görünen ad, hakkında, dil; ayrıca hesap işlemleri (çıkış, veri
 * indirme, hesap silme — KVKK). Sunucu uçları zaten hazır; bu ekran onların
 * arayüzü.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Download, Headphones, LogOut, Mic, UserX, Volume2, X } from 'lucide-react';
import { Limits, type SelfUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore } from '../store';
import { setLocale } from '../i18n';
import { voice, playTestTone, startMicLevelMeter } from '../lib/voice';
import { gateway } from '../lib/gateway';
import { Avatar } from './Avatar';

interface Props {
  user: SelfUser;
  onClose: () => void;
}

/** `KeyboardEvent.code` → okunur ad. Bilinmeyen kodlar olduğu gibi gösterilir. */
const KEY_CODE_LABELS: Record<string, string> = {
  ControlRight: 'Sağ Ctrl',
  ControlLeft: 'Sol Ctrl',
  AltRight: 'Sağ Alt',
  AltLeft: 'Sol Alt',
  ShiftRight: 'Sağ Shift',
  ShiftLeft: 'Sol Shift',
  Space: 'Boşluk',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Tab: 'Tab',
};
function formatKeyCode(code: string): string {
  return KEY_CODE_LABELS[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
}

export function UserSettings({ user, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const setUser = useStore((state) => state.setUser);
  const blocks = useStore((state) => state.blocks);
  const removeBlock = useStore((state) => state.removeBlock);
  const [blockBusyId, setBlockBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Bu modal açıkken kanal sürükle-bırak sıralaması kilitlenir — sekme tam
  // ekran kaplamadığı için native drag altındaki kanal satırlarına sızabiliyordu
  // (bkz. store'daki channelDragLockCount yorumu). Kapanış ne şekilde olursa
  // olsun (X, Escape, dışarı tık) unmount her zaman tetiklenir, kilit açılır.
  useEffect(() => {
    const { lockChannelDrag, unlockChannelDrag } = useStore.getState();
    lockChannelDrag();
    return unlockChannelDrag;
  }, []);

  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayed = displayName.trim() || user.username;

  /* -------- Ses ayarları (bkz. dosya başındaki yorum: hassasiyet, cihaz seçimi, test, gürültü engelleme) -------- */
  const inputSensitivity = useStore((s) => s.inputSensitivity);
  const outputVolume = useStore((s) => s.outputVolume);
  const noiseSuppression = useStore((s) => s.noiseSuppression);
  const inputDeviceId = useStore((s) => s.inputDeviceId);
  const outputDeviceId = useStore((s) => s.outputDeviceId);
  const setInputSensitivity = useStore((s) => s.setInputSensitivity);
  const pushToTalk = useStore((s) => s.pushToTalk);
  const pushToTalkKey = useStore((s) => s.pushToTalkKey);
  const messageSounds = useStore((s) => s.messageSounds);
  const invisible = useStore((s) => s.invisible);
  const setMessageSounds = useStore((s) => s.setMessageSounds);
  const [listeningForKey, setListeningForKey] = useState(false);

  // Tuş yakalama: "Tuşu değiştir"e basınca bir sonraki tuşa basılışı dinle.
  useEffect(() => {
    if (!listeningForKey) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      if (e.key === 'Escape') {
        setListeningForKey(false);
        return;
      }
      voice.setPushToTalkKey(e.code);
      setListeningForKey(false);
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [listeningForKey]);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const micStopRef = useRef<(() => void) | null>(null);

  async function refreshDevices() {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setDevices(list);
  }

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
  }, []);

  // Cihaz etiketleri (label) izin verilene kadar boş gelir — kısa bir
  // getUserMedia isteğiyle izni tetikleyip akışı hemen kapatıyoruz.
  async function requestDeviceLabels() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Reddedildi — cihaz listesi id'lerle (etiketsiz) kalır.
    }
    await refreshDevices();
  }

  const inputDevices = devices.filter((d) => d.kind === 'audioinput');
  const outputDevices = devices.filter((d) => d.kind === 'audiooutput');
  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);

  async function toggleMicTest() {
    if (micTesting) {
      micStopRef.current?.();
      micStopRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
      return;
    }
    try {
      micStopRef.current = await startMicLevelMeter(inputDeviceId, (rms) =>
        setMicLevel(Math.min(1, rms * 4)),
      );
      setMicTesting(true);
    } catch {
      // Mikrofon izni reddedildi — sessizce geç.
    }
  }

  async function testSpeaker() {
    setSpeakerTesting(true);
    await playTestTone(outputDeviceId);
    setTimeout(() => setSpeakerTesting(false), 700);
  }

  // Bileşen kapanırken mikrofon testi açık kaldıysa akışı durdur.
  useEffect(() => () => micStopRef.current?.(), []);

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.patch<SelfUser>('/users/@me', {
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
      });
      setUser(updated);
      setStatus(t('profile.saved'));
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/v1/users/@me/avatar', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!response.ok) {
        const code = ((await response.json()) as { code?: string }).code;
        setError(
          code === 'payload_too_large'
            ? t('profile.avatarTooLarge')
            : code === 'unsupported_file_type'
              ? t('profile.avatarNotImage')
              : t('common.error'),
        );
        return;
      }
      const { avatarUrl: url } = (await response.json()) as { avatarUrl: string };
      setAvatarUrl(url);
      setUser({ ...user, avatarUrl: url });
    } catch {
      setError(t('common.error'));
    }
  }

  function changeLanguage(next: 'tr' | 'en') {
    setLocale(next);
    void api.patch('/users/@me', { locale: next }).catch(() => undefined);
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => undefined);
    location.reload();
  }

  /**
   * "Parolayı değiştir" — inline eski/yeni parola formu YOK, aynı sıfırlama
   * e-postası akışı kullanılıyor (bkz. AuthScreen.tsx "Parolamı unuttum" ile
   * AYNI sunucu ucu: `/auth/request-password-reset`). Kullanıcı raporu:
   * "şifre değiştirme linki maile gitsin ve işlem oradan devam etsin".
   */
  const [changePasswordSent, setChangePasswordSent] = useState(false);
  const [changePasswordBusy, setChangePasswordBusy] = useState(false);
  async function requestPasswordChange() {
    setChangePasswordBusy(true);
    try {
      await api.post('/auth/request-password-reset', { email: user.email });
      setChangePasswordSent(true);
    } finally {
      setChangePasswordBusy(false);
    }
  }

  async function exportData() {
    const data = await api.get('/users/@me/data-export').catch(() => null);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tuscord-verilerim.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function unblock(userId: string) {
    setBlockBusyId(userId);
    await api.delete(`/users/@me/blocks/${userId}`).catch(() => undefined);
    removeBlock(userId);
    setBlockBusyId(null);
  }

  async function deleteAccount() {
    if (!confirm(t('profile.deleteConfirm'))) return;
    try {
      await api.post('/users/@me/delete');
      location.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'owns_guilds'
          ? caught.message
          : t('common.error'),
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('profile.settings')}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-medium">{t('profile.settings')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {/* Avatar + isim önizleme */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative"
              title={t('profile.changeAvatar')}
            >
              <Avatar name={displayed} avatarUrl={avatarUrl} size={72} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                <Camera size={22} />
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
                event.target.value = '';
              }}
            />
            <div>
              <div className="text-lg font-semibold">{displayed}</div>
              <div className="text-sm text-[var(--color-ink-faint)]">
                {user.username}#{user.discriminator}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

          <Field label={t('profile.displayName')}>
            <input
              value={displayName}
              maxLength={Limits.DISPLAY_NAME_MAX}
              placeholder={t('profile.displayNamePlaceholder')}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
            />
          </Field>

          <Field label={t('profile.bio')}>
            <textarea
              value={bio}
              maxLength={Limits.BIO_MAX}
              rows={3}
              placeholder={t('profile.bioPlaceholder')}
              onChange={(event) => setBio(event.target.value)}
              className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
            />
            <div className="mt-1 text-right text-xs text-[var(--color-ink-faint)]">
              {bio.length}/{Limits.BIO_MAX}
            </div>
          </Field>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {t('profile.save')}
            </button>
            {status && <span className="text-sm text-[var(--color-online)]">{status}</span>}
          </div>

          {/* Dil */}
          <Field label={t('profile.language')}>
            <div className="flex gap-2">
              {(['tr', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => changeLanguage(lang)}
                  className={`rounded px-3 py-1.5 text-sm ${
                    i18n.language === lang
                      ? 'bg-[var(--color-brand)] text-black'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-ink-muted)]'
                  }`}
                >
                  {lang === 'tr' ? 'Türkçe' : 'English'}
                </button>
              ))}
            </div>
          </Field>

          {/* Ses ayarları: cihaz seçimi + test, hassasiyet/seviye, gürültü engelleme */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.voice.title')}
            </div>

            {labelsHidden && (
              <button
                type="button"
                onClick={() => void requestDeviceLabels()}
                className="mb-3 w-full rounded border border-dashed border-[var(--color-line)] px-3 py-2 text-left text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
              >
                {t('profile.voice.grantDeviceAccess')}
              </button>
            )}

            <Field label={t('profile.voice.inputDevice')}>
              <div className="flex gap-2">
                <select
                  value={inputDeviceId ?? ''}
                  onChange={(e) => void voice.setInputDevice(e.target.value || null)}
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
                >
                  <option value="">{t('profile.voice.systemDefault')}</option>
                  {inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || t('profile.voice.unnamedDevice')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void toggleMicTest()}
                  className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-2 text-sm ${
                    micTesting
                      ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <Mic size={14} />
                  {micTesting ? t('profile.voice.stopTest') : t('profile.voice.testMic')}
                </button>
              </div>
              {micTesting && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-online)] transition-[width]"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              )}
            </Field>

            <div className="mt-3">
              <Field label={t('profile.voice.outputDevice')}>
                <div className="flex gap-2">
                  <select
                    value={outputDeviceId ?? ''}
                    onChange={(e) => voice.setOutputDevice(e.target.value || null)}
                    className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
                  >
                    <option value="">{t('profile.voice.systemDefault')}</option>
                    {outputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || t('profile.voice.unnamedDevice')}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void testSpeaker()}
                    disabled={speakerTesting}
                    className="flex shrink-0 items-center gap-1.5 rounded bg-[var(--color-surface-3)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                  >
                    <Headphones size={14} /> {t('profile.voice.testSpeaker')}
                  </button>
                </div>
              </Field>
            </div>

            <div className="mt-3">
              <Field label={t('profile.voice.inputSensitivity', { percent: inputSensitivity })}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={inputSensitivity}
                  onChange={(e) => setInputSensitivity(Number(e.target.value))}
                  className="w-full accent-[var(--color-brand)]"
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label={t('profile.voice.outputVolume', { percent: outputVolume })}>
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="shrink-0 text-[var(--color-ink-muted)]" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={outputVolume}
                    onChange={(e) => voice.setOutputVolume(Number(e.target.value))}
                    className="w-full accent-[var(--color-brand)]"
                  />
                </div>
              </Field>
            </div>

            <label className="mt-3 flex items-center justify-between gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2">
              <span className="text-sm">{t('profile.voice.noiseSuppression')}</span>
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => voice.setNoiseSuppression(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
            </label>

            {/* Bas-konuş — sidebardaki klavye ikonuyla AYNI ayar (bkz.
                ChatShell.tsx alt kullanıcı çubuğu), burada tuş de değişir. */}
            <label className="mt-3 flex items-center justify-between gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2">
              <span className="text-sm">{t('voice.pushToTalk')}</span>
              <input
                type="checkbox"
                checked={pushToTalk}
                onChange={(e) => voice.setPushToTalk(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
            </label>
            {pushToTalk && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2">
                <span className="text-sm text-[var(--color-ink-muted)]">{t('voice.pushToTalkKey')}</span>
                <button
                  type="button"
                  onClick={() => setListeningForKey(true)}
                  className="rounded bg-[var(--color-surface-3)] px-3 py-1 text-sm font-medium hover:bg-[var(--color-surface-1)]"
                >
                  {listeningForKey ? t('voice.pushToTalkKeyListening') : formatKeyCode(pushToTalkKey)}
                </button>
              </div>
            )}
          </div>

          {/* Bildirimler */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.notifications.title')}
            </div>
            <label className="flex items-center justify-between gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2">
              <span className="text-sm">{t('profile.notifications.messageSounds')}</span>
              <input
                type="checkbox"
                checked={messageSounds}
                onChange={(e) => setMessageSounds(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
            </label>
            <p className="mt-1.5 px-1 text-xs text-[var(--color-ink-faint)]">
              {t('profile.notifications.messageSoundsHint')}
            </p>
          </div>

          {/* Gizlilik */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.privacy.title')}
            </div>
            <label className="flex items-center justify-between gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2">
              <span className="text-sm">{t('profile.privacy.invisible')}</span>
              <input
                type="checkbox"
                checked={invisible}
                onChange={(e) => gateway.setInvisible(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
            </label>
            <p className="mt-1.5 px-1 text-xs text-[var(--color-ink-faint)]">
              {t('profile.privacy.invisibleHint')}
            </p>
          </div>

          {/* Engellenen kullanıcılar */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.blockedUsers')}
            </div>
            {blocks.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-faint)]">{t('profile.blockedUsersEmpty')}</p>
            ) : (
              <div className="space-y-1.5">
                {blocks.map((block) => (
                  <div
                    key={block.user.id}
                    className="flex items-center gap-2.5 rounded bg-[var(--color-surface-2)] px-2.5 py-1.5"
                  >
                    <Avatar
                      name={block.user.displayName ?? block.user.username}
                      avatarUrl={block.user.avatarUrl}
                      size={26}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {block.user.displayName ?? block.user.username}
                    </span>
                    <button
                      type="button"
                      onClick={() => void unblock(block.user.id)}
                      disabled={blockBusyId === block.user.id}
                      className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                    >
                      <UserX size={12} /> {t('profile.unblock')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Masaüstü uygulaması — web arayüzüyle birebir aynı (bkz. packages/desktop). */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <a
              href="/downloads/Tuscord-Setup-0.1.4.exe"
              className="flex items-center gap-1.5 rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
            >
              <Download size={14} /> {t('profile.downloadDesktopApp')}
            </a>
          </div>

          {/* Hesap */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.account')}
            </div>
            <div className="mb-3 text-sm text-[var(--color-ink-muted)]">
              {t('profile.email')}: {user.email}{' '}
              <span className={user.emailVerified ? 'text-[var(--color-online)]' : 'text-[var(--color-idle)]'}>
                ({user.emailVerified ? t('profile.emailVerified') : t('profile.emailUnverified')})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void requestPasswordChange()}
                disabled={changePasswordBusy || changePasswordSent}
                className="rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {t('profile.changePassword')}
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex items-center gap-1.5 rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
              >
                <LogOut size={14} /> {t('profile.logout')}
              </button>
              <button
                type="button"
                onClick={() => void exportData()}
                className="rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
              >
                {t('profile.exportData')}
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                className="rounded px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
              >
                {t('profile.deleteAccount')}
              </button>
            </div>
            {changePasswordSent && (
              <p className="mt-2 text-sm text-[var(--color-online)]">{t('profile.changePasswordSent')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}
