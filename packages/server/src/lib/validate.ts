import { isSnowflake } from '@tuscord/shared';
import { Errors } from './errors.js';

/**
 * Rota parametresinden snowflake okur.
 * Geçersiz biçim 404 döner, 400 değil: `/guilds/abc` ile var olmayan bir
 * sunucu arasında istemci için fark yok, ve 400 "biçim doğru ama yok"
 * bilgisini sızdırırdı.
 */
export function snowflakeParam(params: unknown, key: string): bigint {
  const value = (params as Record<string, unknown>)?.[key];
  if (!isSnowflake(value)) throw Errors.notFound();
  return BigInt(value);
}

/** İsteğe bağlı snowflake sorgu parametresi (kürsörler). */
export function optionalSnowflake(value: unknown): bigint | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isSnowflake(value)) throw Errors.badRequest('invalid_snowflake', 'Geçersiz kimlik');
  return BigInt(value);
}
