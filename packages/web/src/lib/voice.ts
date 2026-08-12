/**
 * Ses yöneticisi — mesh P2P WebRTC.
 *
 * Medya sunucusu yok: her katılımcı kanaldaki diğer herkese doğrudan bir
 * RTCPeerConnection açar. Sinyalleşme (SDP/ICE) mevcut gateway WebSocket'i
 * üzerinden taşınır; NAT geçişi için ücretsiz public STUN kullanılır.
 *
 * Cam kırılması (glare) önleme: iki taraf da aynı anda teklif göndermesin
 * diye yalnızca userId'si küçük olan taraf teklifi başlatır. İki uçta da
 * aynı karşılaştırma çalıştığı için sonuç deterministik.
 *
 * Sınır: ~6 kişiye kadar iyi çalışır (herkes N-1 akış yükler). Katı NAT
 * arkasındaki bazı kullanıcılar TURN olmadan bağlanamayabilir — ileride
 * coturn/LiveKit ile yükseltilir.
 */

import { GatewayOp, type VoiceSignalPayload, type VoiceStateUpdatePayload } from '@tuscord/shared';
import { gateway } from './gateway';
import { useStore } from '../store';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

/** Ses seviyesi bu eşiği (0–1 RMS) aşarsa "konuşuyor" sayılır. */
const SPEAKING_THRESHOLD = 0.045;

type SignalMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** remoteDescription set edilmeden gelen ICE adayları burada bekler. */
  pendingCandidates: RTCIceCandidateInit[];
  analyser?: AnalyserNode;
}

class VoiceManager {
  private channelId: string | null = null;
  private localStream: MediaStream | null = null;
  private readonly peers = new Map<string, Peer>();
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private speakingRaf: number | null = null;
  /** Tercih edilen mikrofon/hoparlör (cihaz seçiminden). */
  deviceIds: { mic?: string; speaker?: string } = {};

  get currentChannel(): string | null {
    return this.channelId;
  }

  private get myId(): string {
    return useStore.getState().user?.id ?? '';
  }

  /** Bir ses kanalına katıl. Zaten bir kanaldaysak önce ayrıl. */
  async join(channelId: string): Promise<void> {
    if (this.channelId === channelId) return;
    if (this.channelId) this.leave();

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

    // Sunucuya katıldığımı bildir — roster'ı geri alacağım.
    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
    });
  }

  /** Ses kanalından ayrıl — tüm eş bağlantılarını ve mikrofonu kapat. */
  leave(): void {
    if (!this.channelId) return;
    gateway.sendOp(GatewayOp.VOICE_STATE, { channelId: null });

    for (const [peerId, peer] of this.peers) {
      peer.pc.close();
      peer.audio.srcObject = null;
      peer.audio.remove();
      useStore.getState().setSpeaking(peerId, false);
    }
    this.peers.clear();

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    if (this.speakingRaf !== null) cancelAnimationFrame(this.speakingRaf);
    this.speakingRaf = null;
    this.localAnalyser = null;
    void this.audioContext?.close();
    this.audioContext = null;

    this.channelId = null;
    useStore.getState().resetVoiceSession();
  }

  /** Gateway koptu ve döndü: aynı kanala yeniden duyur (eşler yeniden kurulur). */
  rejoinAfterReconnect(): void {
    if (!this.channelId) return;
    const store = useStore.getState();
    // Eski eş bağlantıları büyük ihtimalle öldü; temizle, roster ile yeniden kurulur.
    for (const [peerId, peer] of this.peers) {
      peer.pc.close();
      peer.audio.remove();
      store.setSpeaking(peerId, false);
    }
    this.peers.clear();
    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId: this.channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
    });
  }

  setMute(mute: boolean): void {
    const store = useStore.getState();
    store.setSelfMute(mute);
    this.applyLocalAudioEnabled();
    if (mute) store.setSpeaking(this.myId, false);
    if (this.channelId) {
      gateway.sendOp(GatewayOp.VOICE_STATE, { channelId: this.channelId, selfMute: mute, selfDeaf: store.selfDeaf });
    }
  }

  setDeaf(deaf: boolean): void {
    const store = useStore.getState();
    store.setSelfDeaf(deaf);
    // Kulaklık kapalıysa duymadığın gibi konuşman da beklenmez — mikrofonu da kes.
    if (deaf) store.setSelfMute(true);
    this.applyLocalAudioEnabled();
    // Uzak sesleri sustur/aç.
    for (const peer of this.peers.values()) peer.audio.muted = deaf;
    if (deaf) store.setSpeaking(this.myId, false);
    if (this.channelId) {
      gateway.sendOp(GatewayOp.VOICE_STATE, {
        channelId: this.channelId,
        selfMute: store.selfMute,
        selfDeaf: deaf,
      });
    }
  }

  /** Mikrofonu store'daki mute/deafen durumuna göre aç/kapat. */
  private applyLocalAudioEnabled(): void {
    const { selfMute, selfDeaf } = useStore.getState();
    const enabled = !selfMute && !selfDeaf;
    this.localStream?.getAudioTracks().forEach((track) => (track.enabled = enabled));
  }

  /* -------- Gateway olayları (useGateway'den yönlendirilir) -------- */

  /** Bir kullanıcının ses durumu değişti. Yalnızca kendi kanalımdaki eşleri yönetirim. */
  onVoiceState(payload: VoiceStateUpdatePayload): void {
    if (!this.channelId) return;
    const peerId = payload.userId;
    if (peerId === this.myId) return;

    // Eş benim kanalımda değil (ayrıldı ya da başka kanal): bağlantıyı kapat.
    if (payload.channelId !== this.channelId) {
      this.closePeer(peerId);
      return;
    }

    // Eş benim kanalımda: bağlantı yoksa kur. Küçük id teklifi başlatır.
    if (!this.peers.has(peerId)) {
      const peer = this.createPeer(peerId);
      if (this.myId < peerId) void this.makeOffer(peerId, peer);
    }
  }

  /** Bir eşten SDP/ICE geldi. */
  async onSignal(payload: VoiceSignalPayload): Promise<void> {
    if (!this.channelId || String(payload.channelId) !== this.channelId) return;
    const peerId = payload.from;
    const signal = payload.signal as SignalMessage;
    const peer = this.peers.get(peerId) ?? this.createPeer(peerId);

    try {
      if (signal.type === 'offer') {
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await this.drainCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(peerId, { type: 'answer', sdp: answer.sdp ?? '' });
      } else if (signal.type === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await this.drainCandidates(peer);
      } else if (signal.type === 'candidate') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
        else peer.pendingCandidates.push(signal.candidate);
      }
    } catch (error) {
      console.error('[voice] sinyal işlenemedi', error);
    }
  }

  /* -------- İç mekanizma -------- */

  private createPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = useStore.getState().selfDeaf;

    const peer: Peer = { pc, audio, pendingCandidates: [] };
    this.peers.set(peerId, peer);

    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(peerId, { type: 'candidate', candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        audio.srcObject = stream;
        this.attachRemoteAnalyser(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // 'failed': ICE toparlanamadı. Eşi bırak; roster hâlâ göründüğü için
        // kullanıcı yeniden katılmayı deneyebilir.
        if (pc.connectionState === 'failed') this.closePeer(peerId);
      }
    };

    return peer;
  }

  private async makeOffer(peerId: string, peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(peerId, { type: 'offer', sdp: offer.sdp ?? '' });
    } catch (error) {
      console.error('[voice] teklif oluşturulamadı', error);
    }
  }

  private async drainCandidates(peer: Peer): Promise<void> {
    for (const candidate of peer.pendingCandidates) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        // Yoksay — geç gelen/çift aday.
      }
    }
    peer.pendingCandidates = [];
  }

  private closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(peerId);
    useStore.getState().setSpeaking(peerId, false);
  }

  private sendSignal(to: string, signal: SignalMessage): void {
    if (!this.channelId) return;
    gateway.sendOp(GatewayOp.VOICE_SIGNAL, { to, channelId: this.channelId, signal });
  }

  /* -------- Konuşma tespiti (Web Audio) -------- */

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  private attachRemoteAnalyser(peerId: string, stream: MediaStream): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
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
      // ~15/sn yeterli; her frame ölçmek gereksiz CPU.
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
