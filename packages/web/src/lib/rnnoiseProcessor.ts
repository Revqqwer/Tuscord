/**
 * RNNoise (WASM, AudioWorklet) tabanlı gürültü engelleme — tarayıcının
 * yerleşik `noiseSuppression` constraint'inden çok daha iyi ayırt eder
 * (sabit gürültünün ötesinde, klavye/sokak/arka plan konuşması gibi
 * değişken gürültüleri de bastırır). Tamamen istemci tarafında çalışır,
 * LiveKit sunucusuna hiçbir ek yük bindirmez.
 *
 * LiveKit'in `TrackProcessor` arayüzünü (bkz. livekit-client, @experimental)
 * implemente eder — tip doğrudan export edilmediği için `LocalAudioTrack.
 * setProcessor` imzasından türetiliyor.
 */
import type { LocalAudioTrack } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseWasmSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

type Processor = Parameters<LocalAudioTrack['setProcessor']>[0];
type ProcessorOptions = Parameters<Processor['init']>[0];

// WASM ikilisi büyük değil (~150KB) ama tekrar tekrar indirmeye gerek yok —
// aynı sekmede birden fazla kez katıl/ayrıl olursa tek seferlik kalsın.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
function getWasmBinary(): Promise<ArrayBuffer> {
  wasmBinaryPromise ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseWasmSimdUrl });
  return wasmBinaryPromise;
}

export class RnnoiseProcessor implements Processor {
  name = 'rnnoise-suppressor';
  processedTrack?: MediaStreamTrack;

  private source?: MediaStreamAudioSourceNode;
  private node?: RnnoiseWorkletNode;
  private dest?: MediaStreamAudioDestinationNode;

  async init(opts: ProcessorOptions): Promise<void> {
    const ctx = opts.audioContext;
    await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
    const wasmBinary = await getWasmBinary();

    this.node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    this.source = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.dest = ctx.createMediaStreamDestination();
    this.source.connect(this.node).connect(this.dest);
    this.processedTrack = this.dest.stream.getAudioTracks()[0];
  }

  async restart(opts: ProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.destroy();
    this.dest?.disconnect();
    this.source = undefined;
    this.node = undefined;
    this.dest = undefined;
    this.processedTrack = undefined;
  }
}
