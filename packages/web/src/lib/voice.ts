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

    gateway.sendOp(GatewayOp.VOICE_STATE, {
      channelId,
      selfMute: store.selfMute,
      selfDeaf: store.selfDeaf,
      selfVideo: false,
    });
  }

  leave(): void {
    if (!this.channelId) return;
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
    useStore.getState().resetVoiceSession();
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
    const store = useStore.getState();
    store.setSelfMute(mute);
    this.applyLocalAudioEnabled();
    if (mute) store.setSpeaking(this.myId, false);
    this.announceState();
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
