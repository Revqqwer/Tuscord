/**
 * Ses + ekran paylaşımı yöneticisi — mesh P2P WebRTC.
 *
 * Medya sunucusu yok: her katılımcı kanaldaki herkese doğrudan bir
 * RTCPeerConnection açar. Sinyalleşme (SDP/ICE) mevcut gateway WebSocket'i
 * üzerinden taşınır; NAT geçişi için ücretsiz public STUN kullanılır.
 *
 * Müzakere: "perfect negotiation" deseni. Ekran paylaşımı açmak/kapamak
 * bağlantıyı yeniden müzakere ettirir (yeni video izi eklenir/çıkarılır);
 * iki taraf da aynı anda teklif verirse çakışmayı polite/impolite kuralı
 * çözer — küçük userId impolite, büyük polite.
 *
 * Sınır: ~4-6 kişi (herkes N-1 akış yükler; ekran paylaşımı yükü artırır).
 * Katı NAT arkasındaki bazı kullanıcılar TURN olmadan bağlanamayabilir.
 */

import { GatewayOp, type VoiceSignalPayload, type VoiceStateUpdatePayload } from '@tuscord/shared';
import { gateway } from './gateway';
import { useStore } from '../store';
import { playVoiceChime, suppressChimesForCatchUp } from './voiceChime';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

/** Ses seviyesi bu eşiği (0–1 RMS) aşarsa "konuşuyor" sayılır. */
const SPEAKING_THRESHOLD = 0.045;

type SignalMessage =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

interface Peer {
  pc: RTCPeerConnection;
  /** Perfect negotiation: çakışmada geri adım atan taraf. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** streamId → ses elemanı (mikrofon + varsa ekran sesi ayrı akışlar). */
  audios: Map<string, HTMLAudioElement>;
  /** Konuşma analizi yapılan mikrofon akışı. */
  analyser?: AnalyserNode;
  analyserStreamId?: string;
}

class VoiceManager {
  private channelId: string | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private readonly peers = new Map<string, Peer>();
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private speakingRaf: number | null = null;
  /** Bir moderatör susturdu — kilit açılana kadar kendi mikrofonumu açamam. */
  private serverMuteLocked = false;
  deviceIds: { mic?: string; speaker?: string } = {};

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
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: this.deviceIds.mic
          ? { deviceId: { exact: this.deviceIds.mic }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch {
      store.setVoiceConnecting(false);
      throw new Error('mic_denied');
    }

    this.channelId = channelId;
    store.setVoiceChannel(channelId);
    store.setVoiceConnecting(false);
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
   * uğrar — bu durumda sessize alma/kulaklık kapatma tercihimi KORUMALIYIM
   * (bkz. resetVoiceSession yorumu: normalde tam ayrılışta sıfırlanır).
   * Gerçek "ayrıl" (kullanıcı düğmeye bastı) her zaman sıfırlar — Discord'da
   * da tam bağlantı kesilince mikrofon/kulaklık varsayılana döner.
   */
  leave(switchingChannel = false): void {
    if (!this.channelId) return;
    // resetVoiceSession() selfDeaf'i hemen sıfırlıyor — önce oku.
    const { selfMute, selfDeaf } = useStore.getState();
    if (!selfDeaf) playVoiceChime('leave');
    gateway.sendOp(GatewayOp.VOICE_STATE, { channelId: null });

    this.stopScreenShareTracks();
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.speakingRaf !== null) cancelAnimationFrame(this.speakingRaf);
    this.speakingRaf = null;
    this.localAnalyser = null;
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

  rejoinAfterReconnect(): void {
    if (!this.channelId) return;
    const store = useStore.getState();
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId: this.channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
      selfVideo: store.selfSharing,
    });
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
   * yalnızca kilidi kaldırır — Discord'daki gibi kullanıcı isterse kendi
   * açar, otomatik açılmaz.
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
   * Sunucu authoritative durumu zaten güncelledi (bkz. gateway/index.ts
   * forceMoveVoice) — burada yalnızca YEREL mesh'i buna göre yeniden
   * kuruyoruz: eski kanaldaki eşlerle bağlantıları kapat, kanal id'sini
   * güncelle. Yeni kanaldaki eşler ayrıca gelecek VOICE_STATE_UPDATE
   * paketleriyle kurulur (bkz. onVoiceState) — mikrofon akışı zaten açık
   * olduğu için yeniden `getUserMedia` istemeye gerek yok.
   */
  applyServerMove(channelId: string, channelName: string, guildId: string): void {
    if (this.channelId === channelId) return;
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    this.channelId = channelId;
    useStore.getState().setVoiceChannel(channelId);
    // Hedef kanalda VIEW_CHANNEL olmayabilir — o zaman kanal listemde hiç
    // görünmez, adını buradan öğreniyorum (bkz. VoiceForceMovePayload
    // yorumu). VoiceControlBar, guilds.channels'ta bulamazsa buna düşer.
    useStore.getState().setForcedVoiceChannelInfo({ name: channelName, guildId });
    suppressChimesForCatchUp();
    if (!useStore.getState().selfDeaf) playVoiceChime('join');
  }

  setDeaf(deaf: boolean): void {
    const store = useStore.getState();
    store.setSelfDeaf(deaf);
    if (deaf) store.setSelfMute(true);
    this.applyLocalAudioEnabled();
    for (const peer of this.peers.values()) {
      for (const audio of peer.audios.values()) audio.muted = deaf;
    }
    if (deaf) store.setSpeaking(this.myId, false);
    this.announceState();
  }

  private applyLocalAudioEnabled(): void {
    const { selfMute, selfDeaf } = useStore.getState();
    const enabled = !selfMute && !selfDeaf;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  /* -------- Kişisel ses karıştırma (yalnızca bende, kimseye yansımaz) -------- */

  /**
   * Bir eşten gelen sesin ÇARPIMSAL etkin seviyesi: kanal seviyesi × o
   * kullanıcının seviyesi. "100 -> kanalda 90 -> kullanıcıda %10" örneği
   * tam olarak bunu ifade ediyor: 0.90 × 0.10 = 0.09 (orijinalin %9'u).
   * Sessize alınmışsa (mutedPeerIds) sürgüleri hiç saymadan doğrudan 0.
   */
  private effectiveVolume(peerId: string): number {
    const store = useStore.getState();
    if (store.mutedPeerIds.has(peerId)) return 0;
    const channelPercent = (this.channelId ? store.channelVolumes.get(this.channelId) : undefined) ?? 100;
    const userPercent = store.userVolumes.get(peerId) ?? 100;
    return (channelPercent / 100) * (userPercent / 100);
  }

  private applyVolumeFor(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const volume = this.effectiveVolume(peerId);
    for (const audio of peer.audios.values()) audio.volume = volume;
  }

  /** Şu an bağlı olduğum kanalın sesini (bende) 0-100 arasında ayarla. */
  setChannelVolume(channelId: string, percent: number): void {
    useStore.getState().setChannelVolume(channelId, percent);
    if (channelId !== this.channelId) return; // yalnızca ekrana yansıyan değer güncellendi
    for (const peerId of this.peers.keys()) this.applyVolumeFor(peerId);
  }

  /** Belirli bir kullanıcının sesini (bende) 0-100 arasında ayarla. */
  setUserVolume(peerId: string, percent: number): void {
    useStore.getState().setUserVolume(peerId, percent);
    this.applyVolumeFor(peerId);
  }

  /** Bir kullanıcıyı bende hızlıca sessize al/aç — sürgüyü sıfırlamaz. */
  setPeerMuted(peerId: string, muted: boolean): void {
    useStore.getState().setPeerMuted(peerId, muted);
    this.applyVolumeFor(peerId);
  }

  /* -------- Ekran paylaşımı -------- */

  async startScreenShare(): Promise<void> {
    if (!this.channelId || this.screenStream) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true, // Chrome sekme/sistem sesini de paylaşabilir; varsa gönderilir.
      });
    } catch {
      return; // Kullanıcı iptal etti.
    }
    this.screenStream = stream;
    useStore.getState().setSelfSharing(true);
    useStore.getState().setScreenStream(this.myId, stream);

    // İzleri tüm eşlere ekle → her ekleme yeniden müzakere tetikler.
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) peer.pc.addTrack(track, stream);
    }

    // Kullanıcı tarayıcının "paylaşımı durdur" düğmesine basarsa temizle.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.onended = () => this.stopScreenShare();

    this.announceState();
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;
    const tracks = new Set(this.screenStream.getTracks());
    // İlgili göndericileri her eşten çıkar → yeniden müzakere.
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track && tracks.has(sender.track)) peer.pc.removeTrack(sender);
      }
    }
    this.stopScreenShareTracks();
    useStore.getState().setSelfSharing(false);
    useStore.getState().setScreenStream(this.myId, null);
    this.announceState();
  }

  private stopScreenShareTracks(): void {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  /** Güncel mute/deafen/video durumunu sunucuya duyur. */
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

  /* -------- Gateway olayları -------- */

  onVoiceState(payload: VoiceStateUpdatePayload): void {
    if (!this.channelId) return;
    const peerId = payload.userId;
    if (peerId === this.myId) return;

    if (payload.channelId !== this.channelId) {
      this.closePeer(peerId);
      return;
    }
    // Eş benim kanalımda: bağlantı yoksa kur (izler eklenince müzakere başlar).
    if (!this.peers.has(peerId)) this.createPeer(peerId);
    // Karşı taraf paylaşımı bıraktıysa ekranını temizle (iz sonu kaçarsa yedek).
    if (!payload.selfVideo) useStore.getState().setScreenStream(peerId, null);
  }

  async onSignal(payload: VoiceSignalPayload): Promise<void> {
    if (!this.channelId || String(payload.channelId) !== this.channelId) return;
    const peerId = payload.from;
    const peer = this.peers.get(peerId) ?? this.createPeer(peerId);
    const signal = payload.signal as SignalMessage;

    try {
      if (signal.type === 'description') {
        const description = signal.description;
        const offerCollision =
          description.type === 'offer' && (peer.makingOffer || peer.pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        await peer.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await peer.pc.setLocalDescription();
          this.sendSignal(peerId, { type: 'description', description: peer.pc.localDescription!.toJSON() });
        }
      } else if (signal.type === 'candidate') {
        try {
          await peer.pc.addIceCandidate(signal.candidate);
        } catch (error) {
          if (!peer.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.error('[voice] sinyal işlenemedi', error);
    }
  }

  /* -------- Eş bağlantı yönetimi -------- */

  private createPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    // Büyük id polite: çakışan teklifte geri adımı o atar.
    const peer: Peer = { pc, polite: this.myId > peerId, makingOffer: false, ignoreOffer: false, audios: new Map() };
    this.peers.set(peerId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(peerId, { type: 'description', description: pc.localDescription!.toJSON() });
      } catch (error) {
        console.error('[voice] müzakere hatası', error);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(peerId, { type: 'candidate', candidate: candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      if (event.track.kind === 'video') {
        useStore.getState().setScreenStream(peerId, stream);
        event.track.onended = () => useStore.getState().setScreenStream(peerId, null);
        stream.onremovetrack = () => {
          if (stream.getVideoTracks().length === 0) useStore.getState().setScreenStream(peerId, null);
        };
      } else {
        this.attachAudio(peer, peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(peerId);
    };

    // Mikrofon izini ekle → onnegotiationneeded tetiklenir, teklif akışı başlar.
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    // Halihazırda ekran paylaşıyorsam, sonradan katılan bu eşe de gönder.
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) pc.addTrack(t, this.screenStream);
    }

    return peer;
  }

  private attachAudio(peer: Peer, peerId: string, stream: MediaStream): void {
    if (peer.audios.has(stream.id)) return;
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = useStore.getState().selfDeaf;
    audio.volume = this.effectiveVolume(peerId);
    audio.srcObject = stream;
    peer.audios.set(stream.id, audio);
    // İlk ses akışını mikrofon kabul edip konuşma analizine bağla.
    if (!peer.analyser) {
      this.attachRemoteAnalyser(peer, stream);
      peer.analyserStreamId = stream.id;
    }
  }

  private closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    for (const audio of peer.audios.values()) {
      audio.srcObject = null;
      audio.remove();
    }
    this.peers.delete(peerId);
    useStore.getState().setSpeaking(peerId, false);
    useStore.getState().setScreenStream(peerId, null);
  }

  private sendSignal(to: string, signal: SignalMessage): void {
    if (!this.channelId) return;
    gateway.sendOp(GatewayOp.VOICE_SIGNAL, { to, channelId: this.channelId, signal });
  }

  /* -------- Konuşma tespiti -------- */

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctor();
    }
    return this.audioContext;
  }

  private setupSpeakingDetection(): void {
    if (!this.localStream) return;
    const ctx = this.ensureAudioContext();
    const source = ctx.createMediaStreamSource(this.localStream);
    this.localAnalyser = ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    source.connect(this.localAnalyser);
    this.startSpeakingLoop();
  }

  private attachRemoteAnalyser(peer: Peer, stream: MediaStream): void {
    const ctx = this.ensureAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    peer.analyser = analyser;
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

    let lastTick = 0;
    const loop = (time: number) => {
      this.speakingRaf = requestAnimationFrame(loop);
      if (time - lastTick < 66) return;
      lastTick = time;

      const store = useStore.getState();
      if (this.localAnalyser) {
        const speaking = !store.selfMute && !store.selfDeaf && rms(this.localAnalyser) > SPEAKING_THRESHOLD;
        store.setSpeaking(this.myId, speaking);
      }
      for (const [peerId, peer] of this.peers) {
        if (peer.analyser) store.setSpeaking(peerId, rms(peer.analyser) > SPEAKING_THRESHOLD);
      }
    };
    this.speakingRaf = requestAnimationFrame(loop);
  }
}

export const voice = new VoiceManager();
