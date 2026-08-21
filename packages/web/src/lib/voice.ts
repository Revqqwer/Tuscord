/**
 * Ses + ekran paylaşımı yöneticisi — LiveKit (self-host SFU) istemcisi.
 *
 * ÖNCEDEN mesh P2P'ydi (her katılımcı herkese ayrı RTCPeerConnection açardı,
 * ~4-6 kişiden sonra cızırtı/CPU sorunu çıkıyordu — bkz. git geçmişi). Artık
 * her istemci TEK bir bağlantıyla LiveKit sunucusuna (livekit.tuscord.com)
 * bağlanıyor, medyayı sunucu dağıtıyor. Kendi gateway WebSocket'imizle
 * (VOICE_STATE) hâlâ konuşuyoruz ama SADECE roster/moderasyon için — sinyal
 * (SDP/ICE) artık LiveKit'in kendi bağlantısında, bizim gateway'imizden
 * TAMAMEN bağımsız (bkz. eski VOICE_SIGNAL olayı — kaldırıldı).
 *
 * 1 Tuscord sesli kanalı = 1 LiveKit odası (oda adı = kanal id'si). Katılmadan
 * hemen önce sunucudan kısa ömürlü bir erişim token'ı istenir (bkz.
 * routes/channels.ts POST /channels/:id/voice-token, CONNECT izni gerektirir).
 */

import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant } from 'livekit-client';
import { GatewayOp, type VoiceStateUpdatePayload } from '@tuscord/shared';
import { gateway } from './gateway';
import { api } from './api';
import { useStore } from '../store';
import { playVoiceChime, suppressChimesForCatchUp } from './voiceChime';

/**
 * Kullanıcının 0-100 hassasiyet ayarını (bkz. UserSettings.tsx "Ses" sekmesi)
 * bir RMS eşiğine çevirir — düşük eşik = daha kolay "konuşuyor" tetiklenir.
 * Yalnızca KENDİ mikrofonum için kullanılıyor (bkz. dosya başı yorumu:
 * diğer katılımcıların konuşma göstergesi artık LiveKit'in kendi
 * ActiveSpeakersChanged olayından geliyor, bu eşiğe tabi değil).
 */
function speakingThreshold(): number {
  const sensitivity = useStore.getState().inputSensitivity;
  const MAX = 0.095;
  const MIN = 0.005;
  return MAX - (MAX - MIN) * (sensitivity / 100);
}

class VoiceManager {
  private channelId: string | null = null;
  private room: Room | null = null;
  /** Yalnızca ekran paylaşımı sırasında canlı — force-move'da yeniden
   * getDisplayMedia istemeden yeni odaya tekrar publish edebilmek için. */
  private screenStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private speakingRaf: number | null = null;
  private readonly lastAboveThreshold = new Map<string, number>();
  /** Bir moderatör susturdu — kilit açılana kadar kendi mikrofonumu açamam. */
  private serverMuteLocked = false;

  constructor() {
    this.attachPushToTalkListeners();
  }

  get currentChannel(): string | null {
    return this.channelId;
  }

  private get myId(): string {
    return useStore.getState().user?.id ?? '';
  }

  /* -------- Katıl / ayrıl -------- */

  async join(channelId: string): Promise<void> {
    if (this.channelId === channelId) return;
    // Kanal DEĞİŞTİRME (aynı sunucuda) — sessize alma/kulaklık kapatma
    // korunsun, resetlenmesin. `leave(true)` bu yüzden sıfırlamayı atlıyor.
    if (this.channelId) this.leave(true);

    const store = useStore.getState();
    store.setVoiceConnecting(true);

    let token: string;
    let url: string;
    try {
      const res = await api.post<{ token: string; url: string }>(`/channels/${channelId}/voice-token`);
      token = res.token;
      url = res.url;
    } catch {
      store.setVoiceConnecting(false);
      throw new Error('mic_denied');
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.attachRoomListeners(room);

    try {
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true, this.micConstraints());
    } catch {
      room.disconnect();
      store.setVoiceConnecting(false);
      throw new Error('mic_denied');
    }

    this.room = room;
    this.channelId = channelId;
    store.setVoiceChannel(channelId);
    store.setVoiceConnecting(false);
    // Taze mikrofon izi varsayılan olarak enabled gelir — bas-konuş AÇIKKEN
    // tuş basılı olmadan mikrofon açık kalmasın diye hemen uygula.
    this.applyLocalAudioEnabled();
    this.setupSpeakingDetection();

    // Kalabalık bir kanala girince sunucunun gönderdiği "mevcut durum"
    // yakalama paketleri katılma OLAYI sayılıp art arda ses çalmasın.
    suppressChimesForCatchUp();
    if (!store.selfDeaf) playVoiceChime('join');

    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
      selfVideo: false,
    });
  }

  /**
   * @param switchingChannel `join()` başka bir kanala geçerken önce buraya
   * uğrar — bu durumda sessize alma/kulaklık kapatma tercihimi KORUMALIYIM.
   * Gerçek "ayrıl" (kullanıcı düğmeye bastı) her zaman sıfırlar.
   */
  leave(switchingChannel = false): void {
    if (!this.channelId) return;
    // resetVoiceSession() selfDeaf'i hemen sıfırlıyor — önce oku.
    const { selfMute, selfDeaf } = useStore.getState();
    if (!selfDeaf) playVoiceChime('leave');
    gateway.sendOp(GatewayOp.VOICE_STATE, { channelId: null });

    this.stopScreenShareTracks();
    this.room?.disconnect();
    this.room = null;

    if (this.speakingRaf !== null) cancelAnimationFrame(this.speakingRaf);
    this.speakingRaf = null;
    this.localAnalyser = null;
    this.lastAboveThreshold.clear();
    void this.audioContext?.close();
    this.audioContext = null;

    this.channelId = null;
    this.serverMuteLocked = false;
    useStore.getState().resetVoiceSession();
    if (switchingChannel) {
      useStore.getState().setSelfMute(selfMute);
      useStore.getState().setSelfDeaf(selfDeaf);
    }
  }

  /**
   * Kendi gateway WebSocket'imiz (VOICE_STATE roster'ı) yeniden bağlandığında
   * çağrılır — LiveKit bağlantısı bundan TAMAMEN bağımsız, kendi otomatik
   * yeniden bağlanmasını kendisi yönetiyor (bkz. dosya başı yorumu), o yüzden
   * burada yalnızca roster'a güncel durumu yeniden duyurmak yeterli.
   */
  rejoinAfterReconnect(): void {
    if (!this.channelId) return;
    const store = useStore.getState();
    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId: this.channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
      selfVideo: store.selfSharing,
    });
  }

  /* -------- Cihaz seçimi / gürültü engelleme (bkz. UserSettings.tsx "Ses" sekmesi) -------- */

  private micConstraints(): { deviceId?: { exact: string }; echoCancellation: boolean; noiseSuppression: boolean } {
    const store = useStore.getState();
    return {
      ...(store.inputDeviceId ? { deviceId: { exact: store.inputDeviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: store.noiseSuppression,
    };
  }

  /**
   * Mikrofon cihazını değiştir. Bağlı DEĞİLSEM yalnızca tercih kaydedilir
   * (bir sonraki `join()` bunu kullanır). Bağlıysam LiveKit'in kendi cihaz
   * geçişini kullanıyoruz — yeniden müzakereye gerek kalmadan akış değişir.
   */
  async setInputDevice(deviceId: string | null): Promise<void> {
    useStore.getState().setInputDeviceId(deviceId);
    if (!this.room) return;
    try {
      await this.room.switchActiveDevice('audioinput', deviceId ?? 'default');
    } catch {
      return; // Cihaz artık yok / izin reddedildi — eski akışta kal.
    }
    this.reattachLocalAnalyser();
  }

  /**
   * Hoparlör/kulaklık çıkışını değiştir — LiveKit tüm bağlı ses elemanlarına
   * `setSinkId` ile hemen uygular (Chrome/Edge; Safari desteklemiyor, o zaman
   * sessizce yoksayılır).
   */
  setOutputDevice(deviceId: string | null): void {
    useStore.getState().setOutputDeviceId(deviceId);
    void this.room?.switchActiveDevice('audiooutput', deviceId ?? 'default').catch(() => undefined);
  }

  /**
   * Gürültü engellemeyi aç/kapat — varsayılan AÇIK, kullanıcı kapatabilir.
   * Bağlıysam mevcut mikrofon izine ANINDA `applyConstraints` ile uygulanır.
   */
  setNoiseSuppression(enabled: boolean): void {
    useStore.getState().setNoiseSuppression(enabled);
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (track) void track.mediaStreamTrack.applyConstraints({ noiseSuppression: enabled }).catch(() => undefined);
  }

  /* -------- Mikrofon / kulaklık -------- */

  setMute(mute: boolean): void {
    // Sunucu-taraflı susturma kilidi açıkken kendi kendine açamaz —
    // yalnızca yetkili biri VOICE_FORCE_MUTE(false) gönderip kilidi kaldırabilir.
    if (this.serverMuteLocked && !mute) return;
    const store = useStore.getState();
    store.setSelfMute(mute);
    this.applyLocalAudioEnabled();
    if (mute) store.setSpeaking(this.myId, false);
    this.announceState();
  }

  get isServerMuteLocked(): boolean {
    return this.serverMuteLocked;
  }

  /**
   * VOICE_FORCE_MUTE olayı BANA ait geldiğinde çağrılır (bkz. useGateway.ts).
   * `muted=true`: mikrofonu zorla kapatır ve kilitler. `muted=false`:
   * yalnızca kilidi kaldırır — kullanıcı isterse kendi açar, otomatik açılmaz.
   */
  applyServerMute(muted: boolean): void {
    this.serverMuteLocked = muted;
    if (muted) {
      const store = useStore.getState();
      store.setSelfMute(true);
      this.applyLocalAudioEnabled();
      store.setSpeaking(this.myId, false);
      this.announceState();
    }
  }

  /**
   * VOICE_FORCE_MOVE olayı BANA ait geldiğinde çağrılır (bkz. useGateway.ts).
   * Sunucu authoritative durumu zaten güncelledi — burada yalnızca YEREL
   * LiveKit bağlantısını yeni odaya (kanala) taşıyoruz: eski oda kapanır,
   * yeni oda için taze bir token alınır, mikrofon (ve varsa ekran paylaşımı,
   * canlı MediaStream'i koruyarak) yeniden yayınlanır.
   */
  applyServerMove(channelId: string, channelName: string, guildId: string): void {
    if (this.channelId === channelId) return;
    void this.moveToChannel(channelId, channelName, guildId);
  }

  private async moveToChannel(channelId: string, channelName: string, guildId: string): Promise<void> {
    const wasSharing = useStore.getState().selfSharing;
    this.room?.disconnect();
    this.room = null;

    let token: string;
    let url: string;
    try {
      const res = await api.post<{ token: string; url: string }>(`/channels/${channelId}/voice-token`);
      token = res.token;
      url = res.url;
    } catch {
      // Yeni kanalda CONNECT'im olmayabilir (force-move izinsiz bir yere
      // olamaz normalde, ama token isteği ağ hatasıyla da patlayabilir) —
      // oturumu tamamen kapatmak, yarı bağlı bir durumda kalmaktan iyidir.
      this.channelId = null;
      this.stopScreenShareTracks();
      useStore.getState().resetVoiceSession();
      return;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.attachRoomListeners(room);
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true, this.micConstraints());
    if (wasSharing && this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        const source = track.kind === 'video' ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio;
        await room.localParticipant.publishTrack(track, { source });
      }
    }

    this.room = room;
    this.channelId = channelId;
    useStore.getState().setVoiceChannel(channelId);
    // Hedef kanalda VIEW_CHANNEL olmayabilir — o zaman kanal listemde hiç
    // görünmez, adını buradan öğreniyorum.
    useStore.getState().setForcedVoiceChannelInfo({ name: channelName, guildId });
    // Discord'daki gibi: taşınınca ana panel OTOMATİK o kanala geçer.
    useStore.getState().setActive(guildId, channelId);
    this.applyLocalAudioEnabled();
    this.setupSpeakingDetection();
    suppressChimesForCatchUp();
    if (!useStore.getState().selfDeaf) playVoiceChime('join');
  }

  /**
   * VOICE_FORCE_DISCONNECT olayı BANA ait geldiğinde çağrılır — bir
   * moderatör beni kanaldan çıkardı. Sunucu authoritative durumu zaten
   * temizledi; `leave()` çağırmak zararsız (idempotent).
   */
  applyServerDisconnect(): void {
    this.leave();
  }

  setDeaf(deaf: boolean): void {
    const store = useStore.getState();
    store.setSelfDeaf(deaf);
    if (deaf) store.setSelfMute(true);
    this.applyLocalAudioEnabled();
    // effectiveVolume deaf'i zaten 0'a katlıyor (bkz. aşağısı) — tüm
    // katılımcılara yeniden uygula.
    if (this.room) for (const peerId of this.room.remoteParticipants.keys()) this.applyVolumeFor(peerId);
    if (deaf) store.setSpeaking(this.myId, false);
    this.announceState();
  }

  /**
   * Bas-konuş AÇIKKEN, tuş basılı olmadıkça mikrofon kapalı sayılır.
   * `setMicrophoneEnabled` zaten yayınlanmış izi sessize alır/açar —
   * ilk çağrı yayınlar, sonrakiler ucuz bir mute/unmute sinyali.
   */
  private applyLocalAudioEnabled(): void {
    const { selfMute, selfDeaf, pushToTalk, pushToTalkActive } = useStore.getState();
    const enabled = !selfMute && !selfDeaf && (!pushToTalk || pushToTalkActive);
    void this.room?.localParticipant.setMicrophoneEnabled(enabled, this.micConstraints()).catch(() => undefined);
  }

  /* -------- Bas-konuş (bkz. UserSettings.tsx "Ses" sekmesi) -------- */

  setPushToTalk(enabled: boolean): void {
    useStore.getState().setPushToTalk(enabled);
    useStore.getState().setPushToTalkActive(false);
    this.applyLocalAudioEnabled();
    this.announceState();
  }

  setPushToTalkKey(code: string): void {
    useStore.getState().setPushToTalkKey(code);
  }

  /**
   * Global klavye dinleyicileri — BİR KEZ, modül yüklenirken kurulur.
   * Component mount/unmount'a bağlı DEĞİL. Yazı yazarken (input/textarea/
   * contentEditable) BASTIRILMAZ.
   */
  private attachPushToTalkListeners(): void {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    };

    window.addEventListener('keydown', (e) => {
      const store = useStore.getState();
      if (!store.pushToTalk || !this.channelId || store.pushToTalkActive) return;
      if (e.code !== store.pushToTalkKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      store.setPushToTalkActive(true);
      this.applyLocalAudioEnabled();
    });

    window.addEventListener('keyup', (e) => {
      const store = useStore.getState();
      if (!store.pushToTalk || !store.pushToTalkActive || e.code !== store.pushToTalkKey) return;
      store.setPushToTalkActive(false);
      this.applyLocalAudioEnabled();
    });

    // Pencere odağı kaybolursa (alt-tab vb.) fiziksel tuş bırakılsa bile
    // keyup HİÇ gelmeyebilir — mikrofon açık takılı kalmasın diye güvenlik ağı.
    window.addEventListener('blur', () => {
      const store = useStore.getState();
      if (!store.pushToTalkActive) return;
      store.setPushToTalkActive(false);
      this.applyLocalAudioEnabled();
    });
  }

  /* -------- Kişisel ses karıştırma (yalnızca bende, kimseye yansımaz) -------- */

  /**
   * Bir eşten gelen sesin ÇARPIMSAL etkin seviyesi: ANA çıktı seviyesi ×
   * kanal seviyesi × o kullanıcının seviyesi × (kulaklık kapalıysa 0).
   * Sessize alınmışsa (mutedPeerIds) sürgüleri hiç saymadan doğrudan 0.
   */
  private effectiveVolume(peerId: string): number {
    const store = useStore.getState();
    if (store.selfDeaf || store.mutedPeerIds.has(peerId)) return 0;
    const channelPercent = (this.channelId ? store.channelVolumes.get(this.channelId) : undefined) ?? 100;
    const userPercent = store.userVolumes.get(peerId) ?? 100;
    return (store.outputVolume / 100) * (channelPercent / 100) * (userPercent / 100);
  }

  setOutputVolume(percent: number): void {
    useStore.getState().setOutputVolume(percent);
    if (this.room) for (const peerId of this.room.remoteParticipants.keys()) this.applyVolumeFor(peerId);
  }

  private applyVolumeFor(peerId: string): void {
    const participant = this.room?.remoteParticipants.get(peerId);
    if (!participant) return;
    const volume = this.effectiveVolume(peerId);
    participant.setVolume(volume, Track.Source.Microphone);
    participant.setVolume(volume, Track.Source.ScreenShareAudio);
  }

  setChannelVolume(channelId: string, percent: number): void {
    useStore.getState().setChannelVolume(channelId, percent);
    if (channelId !== this.channelId || !this.room) return;
    for (const peerId of this.room.remoteParticipants.keys()) this.applyVolumeFor(peerId);
  }

  setUserVolume(peerId: string, percent: number): void {
    useStore.getState().setUserVolume(peerId, percent);
    this.applyVolumeFor(peerId);
  }

  setPeerMuted(peerId: string, muted: boolean): void {
    useStore.getState().setPeerMuted(peerId, muted);
    this.applyVolumeFor(peerId);
  }

  /* -------- Ekran paylaşımı -------- */

  async startScreenShare(): Promise<void> {
    if (!this.room || this.screenStream) return;
    let publication;
    try {
      publication = await this.room.localParticipant.setScreenShareEnabled(true, {
        video: true,
        audio: true, // Chrome sekme/sistem sesini de paylaşabilir; varsa gönderilir.
      });
    } catch {
      return; // Kullanıcı iptal etti.
    }
    if (!publication?.track) return;

    // force-move sırasında yeniden getDisplayMedia istemeden yeni odaya
    // tekrar publish edebilmek için akışı canlı tut (bkz. moveToChannel).
    const audioTrack = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
    this.screenStream = new MediaStream(
      [publication.track.mediaStreamTrack, audioTrack?.mediaStreamTrack].filter(
        (t): t is MediaStreamTrack => !!t,
      ),
    );
    useStore.getState().setSelfSharing(true);
    useStore.getState().setScreenStream(this.myId, this.screenStream);

    // Kullanıcı tarayıcının "paylaşımı durdur" düğmesine basarsa temizle.
    publication.track.mediaStreamTrack.onended = () => this.stopScreenShare();

    this.announceState();
  }

  stopScreenShare(): void {
    if (!this.room || !this.screenStream) return;
    void this.room.localParticipant.setScreenShareEnabled(false);
    this.stopScreenShareTracks();
    useStore.getState().setSelfSharing(false);
    useStore.getState().setScreenStream(this.myId, null);
    this.announceState();
  }

  private stopScreenShareTracks(): void {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  /** Güncel mute/deafen/video durumunu sunucuya duyur (roster için — bkz. dosya başı yorumu). */
  private announceState(): void {
    if (!this.channelId) return;
    const store = useStore.getState();
    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId: this.channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
      selfVideo: store.selfSharing,
    });
  }

  /* -------- LiveKit oda olayları -------- */

  private attachRoomListeners(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      const peerId = participant.identity;
      if (track.kind === Track.Kind.Video) {
        useStore.getState().setScreenStream(peerId, new MediaStream([track.mediaStreamTrack]));
        track.mediaStreamTrack.onended = () => useStore.getState().setScreenStream(peerId, null);
      } else {
        track.attach(); // Sesi otomatik çalan bir <audio> elemanı oluşturup ekler.
        this.applyVolumeFor(peerId);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) useStore.getState().setScreenStream(participant.identity, null);
      track.detach().forEach((el) => el.remove());
    });

    // Konuşma göstergesi (diğer katılımcılar) — bkz. dosya başı yorumu:
    // kendi mikrofonum için ayrı, RMS tabanlı bir analiz kullanıyorum
    // (hassasiyet ayarına uysun diye), başkaları için LiveKit'in kendi
    // sunucu taraflı ses seviyesi tespiti çok daha basit ve doğru.
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const store = useStore.getState();
      const speakingIds = new Set(speakers.map((p) => p.identity));
      for (const peerId of room.remoteParticipants.keys()) {
        store.setSpeaking(peerId, speakingIds.has(peerId));
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      useStore.getState().setSpeaking(participant.identity, false);
      useStore.getState().setScreenStream(participant.identity, null);
    });

    // LiveKit istemcisi ağ kesintilerinde KENDİSİ otomatik yeniden bağlanır
    // (Reconnecting → Reconnected). Buraya yalnızca KESİN/nihai bir kopma
    // düşer (ör. sunucu odayı kapattı) — o zaman oturumu tam sıfırlıyoruz,
    // yarı bağlı bir durumda bırakmamak için.
    room.on(RoomEvent.Disconnected, () => {
      if (this.room !== room) return; // Zaten bilerek değiştirdiğimiz (leave/move) bir bağlantı.
      this.leave();
    });
  }

  /* -------- Konuşma tespiti (yalnızca KENDİ mikrofonum) -------- */

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctor();
    }
    return this.audioContext;
  }

  private setupSpeakingDetection(): void {
    this.reattachLocalAnalyser();
    this.startSpeakingLoop();
  }

  /** Mikrofon izi değiştiğinde (cihaz değişimi, force-move) analizörü yeniden bağla. */
  private reattachLocalAnalyser(): void {
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!track) return;
    const ctx = this.ensureAudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    this.localAnalyser = ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    source.connect(this.localAnalyser);
  }

  private startSpeakingLoop(): void {
    if (this.speakingRaf !== null) return;
    const buffer = new Uint8Array(256);

    const rms = (analyser: AnalyserNode): number => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = ((buffer[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buffer.length);
    };

    // Eşiği aştıktan sonra bu kadar süre daha "konuşuyor" gösterilir —
    // kelimeler arası doğal kısa sessizliklerde gösterge yanıp sönmesin diye.
    const HANGOVER_MS = 500;

    const updateSpeaking = (id: string, aboveThreshold: boolean, now: number): boolean => {
      if (aboveThreshold) this.lastAboveThreshold.set(id, now);
      const last = this.lastAboveThreshold.get(id);
      return last !== undefined && now - last < HANGOVER_MS;
    };

    let lastTick = 0;
    const loop = (time: number) => {
      this.speakingRaf = requestAnimationFrame(loop);
      if (time - lastTick < 66) return;
      lastTick = time;

      if (!this.localAnalyser) return;
      const store = useStore.getState();
      const threshold = speakingThreshold();
      const now = performance.now();
      const aboveThreshold = !store.selfMute && !store.selfDeaf && rms(this.localAnalyser) > threshold;
      store.setSpeaking(this.myId, updateSpeaking(this.myId, aboveThreshold, now));
    };
    this.speakingRaf = requestAnimationFrame(loop);
  }
}

type SinkableAudio = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

/** `setSinkId` yalnızca Chrome/Edge'de var — desteklenmiyorsa sessizce yoksay. */
function applySinkId(audio: HTMLAudioElement, deviceId: string | null): void {
  const el = audio as SinkableAudio;
  if (!el.setSinkId) return;
  void el.setSinkId(deviceId ?? '').catch(() => undefined);
}

function newAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctor();
}

/**
 * Ayarlar panelindeki MİKROFON TESTİ — ses kanalına katılmadan, seçili
 * cihazdan canlı bir seviye ölçümü. LiveKit'e bağlı DEĞİL, doğrudan
 * getUserMedia — bu yüzden değişmedi.
 */
export async function startMicLevelMeter(
  deviceId: string | null,
  onLevel: (rms: number) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: useStore.getState().noiseSuppression,
    },
  });
  const ctx = newAudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buffer = new Uint8Array(256);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = ((buffer[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.sqrt(sum / buffer.length));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

/** Ayarlar panelindeki HOPARLÖR TESTİ — seçili çıkışa kısa bir ton çalar. */
export async function playTestTone(deviceId: string | null): Promise<void> {
  const ctx = newAudioContext();
  const dst = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.2;
  osc.frequency.value = 440;
  osc.connect(gain).connect(dst);
  osc.start();

  const audio = new Audio();
  audio.srcObject = dst.stream;
  if (deviceId) applySinkId(audio, deviceId);
  await audio.play().catch(() => undefined);

  setTimeout(() => {
    osc.stop();
    audio.pause();
    void ctx.close();
  }, 700);
}

export const voice = new VoiceManager();
