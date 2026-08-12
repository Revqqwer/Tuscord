import { SnowflakeGenerator } from '@tuscord/shared';
import { env } from '../env.js';

/**
 * Süreç genelinde tek üreteç. Her API/gateway süreci FARKLI bir
 * SNOWFLAKE_WORKER_ID ile başlatılmalı — aynı worker id ile iki süreç
 * çakışan ID üretir.
 */
export const ids = new SnowflakeGenerator(env.SNOWFLAKE_WORKER_ID);

export const nextId = (): bigint => ids.next();
export const nextIdString = (): string => ids.nextString();
