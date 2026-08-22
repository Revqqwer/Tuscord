/**
 * Ses kanalı arayüzü:
 *  - VoiceChannelItem: kanal listesinde hoparlör + katıl/ayrıl + katılımcılar
 *  - VoiceControlBar: bağlıyken alt kullanıcı çubuğunun üstünde mute/deafen/ayrıl
 *
 * Konuşma göstergesi: aktif konuşanın avatarı yeşil halkayla çevrelenir.
 *
 * Ses seviyesi + susturma menüleri (sağ tık):
 *  - Kanal satırı → "Kanal Sesi" (bende, kanaldaki HERKESİ birlikte etkiler).
 *  - Katılımcı satırı → "Kullanıcı Sesi" (bende, yalnızca o kişi), "Sessize
 *    Al" (bende, izinsiz — herkes herkesi yapabilir), "Sunucuda Sustur"
 *    (MUTE_MEMBERS izniyle, HERKESİ etkiler — bkz. voice.ts uyarısı: mesh
 *    P2P'de bu bir istek, kriptografik zorlama değil), "Engelle".
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  Flag,
  Headphones,
  Keyboard,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  ScreenShare,
  ShieldOff,
  UserX,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { defaultStickerForChannel, type APIBlock, type APIChannel } from '@tuscord/shared';
import { useStore } from '../store';
import { voice } from '../lib/voice';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import type { MenuItem } from './ContextMenu';
import { VoiceContextMenu } from './VoiceContextMenu';
import { BlockConfirmModal } from './BlockConfirmModal';

/**
 * Bir katılımcıyı sürükleyip başka bir ses kanalının üstüne bırakınca taşımak
 * için özel drag veri tipi — kanal sıralaması sürüklemesiyle (bkz.
 * ChatShell.tsx ChannelList) karışmasın diye ayrı. `dragover` sırasında
 * yalnızca `types` okunabilir (tarayıcı güvenliği), asıl veri `drop`ta gelir —
 * bu yüzden ChannelList hedef satırı bu tipin varlığına bakarak tanır.
 */
export const VOICE_USER_DRAG_TYPE = 'application/x-tuscord-voice-user';

/**
 * Kanal/kullanıcı ses sağ tık menüsünün açık durumu. ChannelList seviyesinde
 * TEK bir state olarak tutulur (bkz. `menu`/`onOpenMenu` props) — sunucuda
 * birden çok sesli kanal varsa her biri kendi state'ini tutsaydı, biri
 * açıkken diğerine sağ tıklamak ikisini de açık bırakırdı (sağ tık
 * handler'ları `stopPropagation` çağırdığı için `window` seviyesindeki
 * "dışarı tıklama kapatır" dinleyicisi diğer menüye hiç ulaşmıyordu).
 */
export type VoiceMenuState =
  | { kind: 'channel'; x: number; y: number }
  | { kind: 'user'; userId: string; x: number; y: number };

export function VoiceChannelItem({
  channel,
  canServerMute,
  canMoveMembers,
  canDisconnectMembers,
  voiceChannels,
  menu,
  onOpenMenu,
  onCloseMenu,
  extraMenuItems,
  onNavigate,
}: {
  channel: APIChannel;
  /** MUTE_MEMBERS iznim var mı — "Sunucuda Sustur" seçeneği buna bağlı. */
  canServerMute: boolean;
  /** MOVE_MEMBERS iznim var mı — "Taşı: <kanal>" seçenekleri buna bağlı. */
  canMoveMembers: boolean;
  /** DISCONNECT_MEMBERS iznim var mı — "Kanaldan çıkar" seçeneği buna bağlı. */
  canDisconnectMembers: boolean;
  /** Sunucudaki TÜM sesli kanallar — taşıma hedefi listesi burada bunlardan çıkarılır. */
  voiceChannels: APIChannel[];
  /** Şu an açık olan menü BU kanala aitse dolu, değilse null (bkz. VoiceMenuState yorumu). */
  menu: VoiceMenuState | null;
  onOpenMenu: (state: VoiceMenuState) => void;
  onCloseMenu: () => void;
  /**
   * "Kanal Ayarları" / "Yukarı taşı" / "Aşağı taşı" gibi izne göre görünen
   * öğeler — ChatShell.tsx'teki `channelMenu(channel)` sonucu. Eskiden
   * bunlar için ayrı bir sağ tık menüsü vardı: kanalın tam olarak neresine
   * tıklandığına göre ya bu ya ses seviyesi menüsü açılıyordu, kafa
   * karıştırıyordu. Artık TEK menüde, ses seviyesinin altında sürer.
   */
  extraMenuItems: MenuItem[];
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const setActive = useStore((s) => s.setActive);
  const roster = useStore((s) => s.voiceStates.get(channel.id));
  const speaking = useStore((s) => s.voiceSpeaking);
  const selfMuteGlobal = useStore((s) => s.selfMute);
  const selfDeafGlobal = useStore((s) => s.selfDeaf);
  const myId = useStore((s) => s.user?.id);
  const serverMutedUserIds = useStore((s) => s.serverMutedUserIds);
  const mutedPeerIds = useStore((s) => s.mutedPeerIds);
  const channelVolumes = useStore((s) => s.channelVolumes);
  const userVolumes = useStore((s) => s.userVolumes);
  const blocks = useStore((s) => s.blocks);
  const addBlock = useStore((s) => s.addBlock);
  const removeBlock = useStore((s) => s.removeBlock);
  const connectedHere = voiceChannelId === channel.id;

  const [pendingBlock, setPendingBlock] = useState<{ id: string; name: string } | null>(null);

  const participants = roster ? [...roster.values()] : [];

  // Menüdeki katılımcı satırının aksiyonları — canlı state'ten türetilir ki
  // menü açıkken biri sessize alınır/susturulursa etiket hemen güncellensin.
  const menuParticipant =
    menu?.kind === 'user' ? participants.find((p) => p.user.id === menu.userId) : undefined;
  const menuMutedByMe = menuParticipant ? mutedPeerIds.has(menuParticipant.user.id) : false;
  const menuServerMuted = menuParticipant ? serverMutedUserIds.has(menuParticipant.user.id) : false;
  const menuIsBlocked = menuParticipant
    ? blocks.some((b) => b.user.id === menuParticipant.user.id)
    : false;
  const userMenuItems: MenuItem[] = menuParticipant
    ? [
        {
          label: menuMutedByMe ? t('voice.unmutePeer') : t('voice.mutePeer'),
          icon: menuMutedByMe ? <Volume2 size={15} /> : <VolumeX size={15} />,
          onClick: () => voice.setPeerMuted(menuParticipant.user.id, !menuMutedByMe),
        },
        ...(canServerMute
          ? [
              {
                label: menuServerMuted ? t('voice.serverUnmute') : t('voice.serverMute'),
                icon: menuServerMuted ? <Lock size={15} /> : <ShieldOff size={15} />,
                onClick: () => void toggleServerMute(menuParticipant.user.id, !menuServerMuted),
              } satisfies MenuItem,
            ]
          : []),
        // Taşıma hedefi mevcut kanalın kendisi hariç diğer tüm sesli kanallar —
        // hedefte CONNECT izni olması gerekmez, bkz. moderation.ts voice-move.
        ...(canMoveMembers
          ? voiceChannels
              .filter((c) => c.id !== channel.id)
              .map(
                (target): MenuItem => ({
                  label: t('voice.moveTo', { channel: target.name }),
                  icon: <ArrowRightLeft size={15} />,
                  onClick: () => void moveMember(menuParticipant.user.id, target.id),
                }),
              )
          : []),
        ...(canDisconnectMembers
          ? [
              {
                label: t('voice.disconnectMember'),
                icon: <PhoneOff size={15} />,
                danger: true,
                onClick: () => void disconnectMember(menuParticipant.user.id),
              } satisfies MenuItem,
            ]
          : []),
        {
          label: menuIsBlocked ? t('profile.unblock') : t('profile.block'),
          icon: <UserX size={15} />,
          danger: !menuIsBlocked,
          onClick: () =>
            void toggleBlock(
              menuParticipant.user.id,
              menuParticipant.user.displayName ?? menuParticipant.user.username,
            ),
        },
        {
          label: t('voice.reportUser'),
          icon: <Flag size={15} />,
          danger: true,
          onClick: () =>
            useStore.getState().setReportTarget({ targetType: 'user', targetId: menuParticipant.user.id }),
        },
      ]
    : [];

  async function join() {
    onNavigate();
    // Discord'daki gibi: sesli kanala tıklamak hem bağlanır (veya zaten
    // bağlıysa yalnızca) HEM DE ortadaki alanı o kanalın katılımcı
    // ızgarasına çevirir (bkz. ChatShell.tsx — activeChannelId sesli kanala
    // eşitse VoiceCallView gösteriliyor).
    if (channel.guildId) setActive(channel.guildId, channel.id);
    if (connectedHere) return;
    try {
      await voice.join(channel.id);
    } catch {
      // Mikrofon reddedildi vb. — kullanıcıya bileşen dışı bir uyarı gerekmez.
    }
  }

  async function toggleServerMute(userId: string, muted: boolean) {
    await api
      .put(`/guilds/${channel.guildId}/members/${userId}/voice-mute`, { muted })
      .catch(() => undefined); // 403/hiyerarşi hatası — sessizce geç, buton zaten izne göre gizli
  }

  async function moveMember(userId: string, targetChannelId: string) {
    await api
      .put(`/guilds/${channel.guildId}/members/${userId}/voice-move`, { channelId: targetChannelId })
      .catch(() => undefined); // 403/hiyerarşi hatası — sessizce geç, buton zaten izne göre gizli
  }

  async function disconnectMember(userId: string) {
    await api
      .put(`/guilds/${channel.guildId}/members/${userId}/voice-disconnect`)
      .catch(() => undefined); // 403/hiyerarşi hatası — sessizce geç, buton zaten izne göre gizli
  }

  async function toggleBlock(userId: string, name: string) {
    const isBlocked = blocks.some((b) => b.user.id === userId);
    if (isBlocked) {
      await api.delete(`/users/@me/blocks/${userId}`).catch(() => undefined);
      removeBlock(userId);
    } else {
      setPendingBlock({ id: userId, name }); // onay bizim modalımızda — bkz. aşağıdaki render
    }
  }

  async function confirmBlock() {
    if (!pendingBlock) return;
    const { id } = pendingBlock;
    setPendingBlock(null);
    const block = await api.put<APIBlock>(`/users/@me/blocks/${id}`).catch(() => null);
    if (block) addBlock(block);
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Satırın HERHANGİ bir yerine (buton, katılımcı listesi altındaki
        // boşluklar) sağ tık — hep AYNI birleşik menü açılır (bkz.
        // extraMenuItems yorumu). Bir katılımcının kendi satırı bunu
        // kendi onContextMenu'sünde durdurup (stopPropagation) kullanıcı
        // menüsünü açar, buraya hiç düşmez.
        onOpenMenu({ kind: 'channel', x: e.clientX, y: e.clientY });
      }}
      // Vurgu (hover) TÜM kanal elementini (isim satırı + katılımcı listesi)
      // kaplasın diye burada, dıştaki sarmalayıcıda — metin kanalındaki gibi
      // tek parça bir "tıklanabilir kart" hissi (bkz. kullanıcı raporu).
      // İçteki buton kendi arka planını YÖNETMEZ artık, yalnızca metin/ikon
      // rengini.
      className="cursor-pointer rounded transition-colors hover:bg-[var(--color-surface-2)]"
    >
      <button
        type="button"
        onClick={() => void join()}
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-base ${
          connectedHere ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
        }`}
      >
        {/* Sesli kanal sticker'ı: elle seçilmişse `channel.sticker`, yoksa kanal
            id'sinden türetilen sabit varsayılan (bkz. shared/limits.ts). Kanal
            Ayarları'ndan değiştirilebilir. Metin kanalları Hash (#) ile
            göstermeye devam ediyor, burası dokunulmadı. */}
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-xs leading-none"
          aria-hidden="true"
        >
          {channel.sticker ?? defaultStickerForChannel(channel.id)}
        </span>
        <span className="truncate">{channel.name}</span>
        {participants.length > 0 && (
          <span className="ml-auto text-xs text-[var(--color-ink-faint)]">{participants.length}</span>
        )}
      </button>

      {participants.length > 0 && (
        <div className="mb-1 ml-3 space-y-0.5 border-l border-[var(--color-line)] pl-2">
          {participants.map((p) => {
            const isMe = p.user.id === myId;
            const isSpeaking = speaking.has(p.user.id);
            // Kendi mute/deafen durumum store'dan; başkalarınınki roster'dan.
            const muted = isMe ? selfMuteGlobal : p.selfMute;
            const deaf = isMe ? selfDeafGlobal : p.selfDeaf;
            const serverMuted = serverMutedUserIds.has(p.user.id);
            const mutedByMe = !isMe && mutedPeerIds.has(p.user.id);
            const isBlocked = blocks.some((b) => b.user.id === p.user.id);

            return (
              <div
                key={p.user.id}
                draggable={canMoveMembers && !isMe}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isMe) return;
                  onOpenMenu({ kind: 'user', userId: p.user.id, x: e.clientX, y: e.clientY });
                }}
                onDragStart={(e) => {
                  if (!canMoveMembers || isMe) return;
                  // Üst kanal satırı da draggable — bu olay ona sıçrarsa kanal
                  // sıralaması sürüklemesi başlar. Durdurmazsak ikisi çakışır.
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData(VOICE_USER_DRAG_TYPE, p.user.id);
                }}
                onDragEnd={(e) => e.stopPropagation()}
                className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm ${
                  canMoveMembers && !isMe ? 'cursor-grab active:cursor-grabbing' : ''
                }`}
              >
                <span
                  className={`inline-flex shrink-0 rounded-full ${
                    isSpeaking ? 'ring-2 ring-[var(--color-online)]' : 'ring-2 ring-transparent'
                  }`}
                >
                  <Avatar name={p.user.displayName ?? p.user.username} avatarUrl={p.user.avatarUrl} size={22} />
                </span>
                <span className="truncate text-[var(--color-ink-muted)]">
                  {p.user.displayName ?? p.user.username}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[var(--color-ink-faint)]">
                  {p.selfVideo ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        // Satırın tıklaması zaten join()'i tetikler (bkz. üstteki
                        // buton) ama biz o async akışın SONUNDA hangi kişiye
                        // odaklanılacağını da belirtmemiz lazım — bu yüzden
                        // burada bubbling'e izin VERMİYORUZ, ikisini de elle
                        // çağırıyoruz (bkz. kullanıcı isteği: canlı rozetine
                        // dokununca doğrudan o kişinin yayınına gitsin).
                        e.stopPropagation();
                        void join();
                        useStore.getState().requestFocusOnStream(p.user.id);
                      }}
                      className="flex items-center gap-0.5 rounded bg-[var(--color-danger)]/15 px-1 text-[9px] font-bold uppercase text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25"
                    >
                      <ScreenShare size={10} /> {t('voice.live')}
                    </button>
                  ) : null}
                  {mutedByMe && (
                    <VolumeX size={12} className="text-[var(--color-idle)]" aria-label={t('voice.mutedByMe')} />
                  )}
                  {serverMuted && (
                    <Lock size={12} className="text-[var(--color-danger)]" aria-label={t('voice.serverMuted')} />
                  )}
                  {deaf ? <Headphones size={12} className="text-[var(--color-danger)]" /> : null}
                  {muted ? <MicOff size={12} className="text-[var(--color-danger)]" /> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {menu?.kind === 'channel' && (
        <VoiceContextMenu
          x={menu.x}
          y={menu.y}
          volumeLabel={t('voice.channelVolume')}
          volumeValue={channelVolumes.get(channel.id) ?? 100}
          onVolumeChange={(v) => voice.setChannelVolume(channel.id, v)}
          items={extraMenuItems}
          onClose={onCloseMenu}
        />
      )}
      {menu?.kind === 'user' && menuParticipant && (
        <VoiceContextMenu
          x={menu.x}
          y={menu.y}
          volumeLabel={t('voice.userVolume')}
          volumeValue={userVolumes.get(menuParticipant.user.id) ?? 100}
          onVolumeChange={(v) => voice.setUserVolume(menuParticipant.user.id, v)}
          items={userMenuItems}
          onClose={onCloseMenu}
        />
      )}
      {pendingBlock && (
        <BlockConfirmModal
          name={pendingBlock.name}
          onConfirm={() => void confirmBlock()}
          onCancel={() => setPendingBlock(null)}
        />
      )}
    </div>
  );
}

/** Bağlıyken görünen alt kontrol çubuğu. */
export function VoiceControlBar() {
  const { t } = useTranslation();
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const connecting = useStore((s) => s.voiceConnecting);
  const selfMute = useStore((s) => s.selfMute);
  const selfDeaf = useStore((s) => s.selfDeaf);
  const selfSharing = useStore((s) => s.selfSharing);
  const pushToTalk = useStore((s) => s.pushToTalk);
  const guilds = useStore((s) => s.guilds);
  const myId = useStore((s) => s.user?.id);
  const serverMutedUserIds = useStore((s) => s.serverMutedUserIds);
  const serverMuteLocked = myId ? serverMutedUserIds.has(myId) : false;
  const forcedInfo = useStore((s) => s.forcedVoiceChannelInfo);

  if (!voiceChannelId && !connecting) return null;

  // Bağlı olduğum ses kanalının adı + sunucusu.
  let channelName = '';
  let guildName = '';
  let channelVisible = false;
  for (const g of guilds.values()) {
    const ch = g.channels.find((c) => c.id === voiceChannelId);
    if (ch) {
      channelName = ch.name ?? '';
      guildName = g.guild.name;
      channelVisible = true;
      break;
    }
  }
  // Kanal listemde YOK — MOVE_MEMBERS ile VIEW_CHANNEL iznim olmayan bir
  // kanala taşınmışım demektir (bkz. forcedVoiceChannelInfo yorumu). Adını/
  // sunucusunu oradan al — kanal + katılımcı listesi artık ChannelList'te
  // sentetik bir satır olarak, DİĞER sesli kanallarla aynı görünümde
  // gösteriliyor (bkz. ChatShell.tsx forcedChannel), burada TEKRAR
  // göstermeye gerek yok.
  if (!channelVisible && forcedInfo) {
    channelName = forcedInfo.name;
    guildName = guilds.get(forcedInfo.guildId)?.guild.name ?? guildName;
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <Volume2 size={16} className="shrink-0 text-[var(--color-online)]" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-[var(--color-online)]">
            {connecting ? t('voice.connecting') : t('voice.connected')}
          </div>
          <div className="truncate text-xs text-[var(--color-ink-faint)]">
            {channelName} {guildName && `· ${guildName}`}
          </div>
        </div>
      </div>

      {serverMuteLocked && (
        <p className="flex items-center gap-1.5 rounded bg-[var(--color-danger)]/15 px-2 py-1 text-xs text-[var(--color-danger)]">
          <Lock size={12} /> {t('voice.youAreServerMuted')}
        </p>
      )}

      <div className="flex items-center gap-1">
        <ControlButton
          active={selfMute}
          disabled={serverMuteLocked && !selfMute}
          label={
            serverMuteLocked
              ? t('voice.youAreServerMuted')
              : selfMute
                ? t('voice.unmute')
                : t('voice.mute')
          }
          onClick={() => voice.setMute(!selfMute)}
        >
          {serverMuteLocked ? <Lock size={16} /> : selfMute ? <MicOff size={16} /> : <Mic size={16} />}
        </ControlButton>
        <ControlButton
          active={selfDeaf}
          label={selfDeaf ? t('voice.undeafen') : t('voice.deafen')}
          onClick={() => voice.setDeaf(!selfDeaf)}
        >
          {selfDeaf ? <VolumeX size={16} /> : <Headphones size={16} />}
        </ControlButton>
        <ControlButton
          active={pushToTalk}
          activeTone="online"
          label={pushToTalk ? t('voice.pushToTalkOff') : t('voice.pushToTalkOn')}
          onClick={() => voice.setPushToTalk(!pushToTalk)}
        >
          <Keyboard size={16} />
        </ControlButton>
        <ControlButton
          active={selfSharing}
          label={selfSharing ? t('voice.stopShare') : t('voice.share')}
          onClick={() => (selfSharing ? voice.stopScreenShare() : void voice.startScreenShare())}
        >
          {selfSharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
        </ControlButton>
        <button
          type="button"
          onClick={() => voice.leave()}
          title={t('voice.disconnect')}
          aria-label={t('voice.disconnect')}
          className="ml-auto flex items-center gap-1 rounded bg-[var(--color-danger)]/15 px-2 py-1.5 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25"
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  active,
  disabled,
  label,
  onClick,
  children,
  activeTone = 'danger',
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /**
   * Aktifken renk — varsayılan kırmızı (mute/deafen/paylaşım için "dikkat"
   * anlamında uygun). Bas-konuş için YEŞİL istendi (bkz. kullanıcı raporu:
   * "tuşu yeşil olsun kırmızı olmasın") — o, bir uyarı değil "hazır" durumu.
   */
  activeTone?: 'danger' | 'online';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex flex-1 items-center justify-center rounded px-2 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? activeTone === 'online'
            ? 'bg-[var(--color-online)]/15 text-[var(--color-online)]'
            : 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}
