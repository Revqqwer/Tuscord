/**
 * Gateway istemcisi.
 *
 * Sorumlulukları: bağlan, HEARTBEAT gönder, kopunca RESUME dene, olmazsa
 * yeniden IDENTIFY et. Üstel geri çekilme (jitter'lı) kullanılır — sunucu
 * yeniden başladığında tüm istemcilerin aynı anda dönmesi ikinci bir
 * çöküş yaratır.
 */

import {
  GatewayCloseCode,
  GatewayOp,
  PresenceStatus,
  type GatewayEvent,
  type GatewayPacket,
  type HelloPayload,
  type ReadyPayload,
} from '@tuscord/shared';
import { useStore } from '../store';

export type GatewayListener = (event: GatewayEvent, payload: unknown) => void;
export type StatusListener = (status: GatewayStatus) => void;
export type GatewayStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed';

/** Bu kodlarda yeniden denemek anlamsız — kullanıcı müdahalesi gerekiyor. */
const FATAL_CODES = new Set<number>([
  GatewayCloseCode.AUTHENTICATION_FAILED,
  GatewayCloseCode.ACCOUNT_DISABLED,
]);

export class GatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private seq = 0;
  private sessionId: string | null = null;
  private intentionalClose = false;

  private readonly listeners = new Set<GatewayListener>();
  private readonly statusListeners = new Set<StatusListener>();

  connect(): void {
    this.intentionalClose = false;
    this.emitStatus(this.sessionId ? 'reconnecting' : 'connecting');

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/gateway`);
    this.socket = socket;

    socket.onmessage = (event) => this.handlePacket(JSON.parse(event.data as string) as GatewayPacket);

    socket.onclose = (event) => {
      this.stopHeartbeat();
      if (this.intentionalClose || FATAL_CODES.has(event.code)) {
        this.emitStatus('closed');
        return;
      }
      // Oturum sürdürülemiyorsa sıfırdan bağlan.
      if (event.code === GatewayCloseCode.INVALID_SEQ || event.code === GatewayCloseCode.SESSION_EXPIRED) {
        this.sessionId = null;
        this.seq = 0;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'İstemci kapattı');
    this.socket = null;
    this.emitStatus('closed');
  }

  on(listener: GatewayListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private handlePacket(packet: GatewayPacket): void {
    switch (packet.op) {
      case GatewayOp.HELLO: {
        const payload = packet.d as HelloPayload;
        this.startHeartbeat(payload.heartbeatIntervalMs);
        // Oturum varsa önce sürdürmeyi dene: kaçırılan mesajlar geri gelir.
        if (this.sessionId) {
          this.send({
            op: GatewayOp.RESUME,
            d: { token: '', sessionId: this.sessionId, seq: this.seq },
          });
        } else {
          const status = useStore.getState().invisible ? PresenceStatus.INVISIBLE : PresenceStatus.ONLINE;
          this.send({ op: GatewayOp.IDENTIFY, d: { token: '', status } });
        }
        break;
      }

      case GatewayOp.DISPATCH: {
        if (typeof packet.s === 'number') this.seq = packet.s;
        if (packet.t === 'READY') {
          const payload = packet.d as ReadyPayload;
          this.sessionId = payload.sessionId;
          this.attempt = 0;
          this.emitStatus('ready');
        }
        if (packet.t === 'RESUMED') {
          this.attempt = 0;
          this.emitStatus('ready');
        }
        if (packet.t) {
          for (const listener of this.listeners) listener(packet.t, packet.d);
        }
        break;
      }

      case GatewayOp.INVALID_SESSION: {
        const payload = packet.d as { resumable: boolean } | undefined;
        if (!payload?.resumable) {
          this.sessionId = null;
          this.seq = 0;
        }
        break;
      }

      case GatewayOp.RECONNECT:
        this.socket?.close(4000, 'Sunucu yeniden bağlanmamızı istedi');
        break;

      case GatewayOp.HEARTBEAT_ACK:
        break;
    }
  }

  /** Dışarıdan opcode gönderimi (ses durumu / WebRTC sinyali). */
  sendOp(op: GatewayOp, d: unknown): void {
    this.send({ op, d });
  }

  /**
   * Çevrimiçi durumumu gizle/göster — UserSettings.tsx buradan çağırır.
   * Yerel tercihi kaydeder (bkz. store.setInvisible, localStorage'da kalıcı
   * — bir sonraki IDENTIFY'da da uygulanır, bkz. connect()) VE bağlıysam
   * ANINDA sunucuya bildirir, yeniden bağlanmayı beklemez.
   */
  setInvisible(value: boolean): void {
    useStore.getState().setInvisible(value);
    if (this.isOpen) {
      this.sendOp(GatewayOp.PRESENCE_UPDATE, {
        status: value ? PresenceStatus.INVISIBLE : PresenceStatus.ONLINE,
      });
    }
  }

  /** Bağlantı açık mı — ses yöneticisi yeniden bağlanmayı buradan anlar. */
  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private send(packet: GatewayPacket): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packet));
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: GatewayOp.HEARTBEAT, d: this.seq });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    // 1s, 2s, 4s… 30s tavanı + %30 jitter (eşzamanlı geri dönüş dalgasını kırar).
    const base = Math.min(30_000, 1000 * 2 ** (this.attempt - 1));
    const delay = base * (0.7 + Math.random() * 0.6);
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private emitStatus(status: GatewayStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}

export const gateway = new GatewayClient();
