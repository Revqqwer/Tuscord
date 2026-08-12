import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScanVerdict } from './imageScanner.js';
import type { DetectedType } from './fileType.js';

/**
 * imageScanner ve env'i mock'la: karar mantığını (resolveScanStatus) gerçek
 * bir tarama servisi veya ortam değişkeni olmadan test et.
 */
const scanMock = vi.fn<() => Promise<ScanVerdict>>();
let failModeValue: 'open' | 'closed' = 'open';

vi.mock('./imageScanner.js', () => ({
  get failMode() {
    return failModeValue;
  },
  imageScanner: {
    name: 'mock',
    scan: () => scanMock(),
  },
  scanningEnabled: true,
}));

// db/schema/id, env → gerçek bağlantı açmasın diye mock'la. resolveScanStatus
// bunların hiçbirine dokunmuyor (yalnızca runScan kullanır), yalnızca import
// zincirini kırmak için.
vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../db/schema.js', () => ({ attachments: {}, reports: {} }));
vi.mock('../lib/id.js', () => ({ nextId: () => 1n }));

const { resolveScanStatus } = await import('./contentScan.js');

const image: DetectedType = { mime: 'image/png', extension: 'png', kind: 'image' };
const pdf: DetectedType = { mime: 'application/pdf', extension: 'pdf', kind: 'document' };

function request(type: DetectedType) {
  return { attachmentId: 1n, uploaderId: 2n, body: Buffer.from('x'), type };
}

describe('resolveScanStatus', () => {
  beforeEach(() => {
    scanMock.mockReset();
    failModeValue = 'open';
  });

  it('görsel olmayan dosya taranmaz, doğrudan clean', async () => {
    expect(await resolveScanStatus(request(pdf))).toBe('clean');
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('temiz görsel → clean', async () => {
    scanMock.mockResolvedValue('clean');
    expect(await resolveScanStatus(request(image))).toBe('clean');
  });

  it('işaretli görsel → flagged', async () => {
    scanMock.mockResolvedValue('flagged');
    expect(await resolveScanStatus(request(image))).toBe('flagged');
  });

  it('tarama hatası + fail-open → pending (görünür, kuyruğa alınır)', async () => {
    failModeValue = 'open';
    scanMock.mockResolvedValue('error');
    expect(await resolveScanStatus(request(image))).toBe('pending');
  });

  it('tarama hatası + fail-closed → flagged (engellenir)', async () => {
    failModeValue = 'closed';
    scanMock.mockResolvedValue('error');
    expect(await resolveScanStatus(request(image))).toBe('flagged');
  });
});
