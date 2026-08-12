/**
 * Denetim kaydı — her yönetici eylemi aktör + hedef + değişiklik + zaman ile yazılır.
 *
 * Bu isteğe bağlı değil (spec Bölüm 8): bir kaldırma talebine cevap verirken
 * "kim ne zaman ne yaptı" sorusuna dakikalar içinde cevap verebilmek gerekiyor.
 *
 * Kayıt yazılamazsa eylem geri alınmaz ama hata loglanır — moderasyon eylemini
 * denetim kaydı yüzünden bloke etmek, kötü niyetli içeriğin ayakta kalmasına
 * yol açardı.
 */

import type { AuditLogAction } from '@tuscord/shared';
import { db } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { nextId } from '../lib/id.js';

export type AuditChanges = Record<string, { before: unknown; after: unknown }>;

export interface WriteAuditLogInput {
  guildId: bigint;
  actorId: bigint;
  actionType: AuditLogAction | string;
  targetId?: bigint | null;
  reason?: string | null;
  /** Doğrudan verilen değişiklik listesi. */
  changes?: AuditChanges;
  /** Ya da: önce/sonra kayıtları + karşılaştırılacak alanlar. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  keys?: string[];
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    let changes = input.changes ?? null;

    if (!changes && input.before && input.after && input.keys) {
      const diff: AuditChanges = {};
      for (const key of input.keys) {
        const before = input.before[key];
        const after = input.after[key];
        if (serialize(before) !== serialize(after)) {
          diff[key] = { before: normalize(before), after: normalize(after) };
        }
      }
      changes = Object.keys(diff).length > 0 ? diff : null;
    }

    await db.insert(auditLog).values({
      id: nextId(),
      guildId: input.guildId,
      actorId: input.actorId,
      actionType: input.actionType,
      targetId: input.targetId ?? null,
      changes,
      reason: input.reason ?? null,
    });
  } catch (error) {
    console.error('[denetim] kayıt yazılamadı', { actionType: input.actionType, error });
  }
}

/** bigint ve Date, JSON.stringify tarafından desteklenmez; karşılaştırma için normalize et. */
function serialize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  return value ?? null;
}
