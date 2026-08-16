import { describe, expect, it } from 'vitest';
import {
  Limits,
  channelNameError,
  guildNameError,
  normalizeChannelName,
  normalizeGuildName,
} from './limits.js';

describe('channelNameError', () => {
  it('geçerli adları kabul eder', () => {
    expect(channelNameError('genel')).toBeNull();
    expect(channelNameError('sesli-sohbet')).toBeNull();
    expect(channelNameError('kanal_1')).toBeNull();
    expect(channelNameError('çğıöşü')).toBeNull();
  });

  it('boşluk ve büyük harf içeren adları kabul eder — artık slug\'a çevrilmez', () => {
    expect(channelNameError('Genel Sohbet')).toBeNull();
    expect(channelNameError('Oyun Odası 42')).toBeNull();
    expect(normalizeChannelName('Genel Sohbet')).toBe('Genel Sohbet');
    expect(normalizeChannelName('  Genel   Sohbet  ')).toBe('Genel Sohbet'); // iç boşluklar teke iner
  });

  it('üç karakterden kısa adları reddeder', () => {
    expect(channelNameError('a')).toBe('too_short');
    expect(channelNameError('ab')).toBe('too_short');
    expect(channelNameError('   ')).toBe('too_short'); // boşluk = boş

  });

  it('sembolü SESSİZCE SİLMEZ, reddeder', () => {
    // `genel!` sessizce `genel` olsaydı kullanıcı yazdığı karakterin yok
    // sayıldığını fark etmezdi — bunun yerine reddedilir.
    expect(channelNameError('@!\\')).toBe('invalid_chars');
    expect(channelNameError('!!!!!')).toBe('invalid_chars');
    expect(channelNameError('genel!')).toBe('invalid_chars');
    expect(channelNameError('a@!')).toBe('invalid_chars');
    expect(channelNameError('kanal#1')).toBe('invalid_chars');
  });

  it('sınırdaki uzunlukları doğru değerlendirir', () => {
    expect(channelNameError('abc')).toBeNull();
    expect(channelNameError('a'.repeat(Limits.CHANNEL_NAME_MAX))).toBeNull();
    expect(channelNameError('a'.repeat(Limits.CHANNEL_NAME_MAX + 1))).toBe('too_long');
  });
});

describe('guildNameError', () => {
  it('boşluk ve büyük harf içeren adları kabul eder', () => {
    expect(guildNameError('Benim Sunucum')).toBeNull();
    expect(guildNameError('Oyun Odası 42')).toBeNull();
    expect(guildNameError('abc')).toBeNull();
  });

  it('sembolleri reddeder', () => {
    expect(guildNameError('Sunucu!')).toBe('invalid_chars');
    expect(guildNameError('a@b')).toBe('invalid_chars');
    expect(guildNameError('ters\\bölü')).toBe('invalid_chars');
  });

  it('kanal adıyla aynı uzunluk sınırlarını uygular', () => {
    expect(Limits.GUILD_NAME_MIN).toBe(Limits.CHANNEL_NAME_MIN);
    expect(Limits.GUILD_NAME_MAX).toBe(Limits.CHANNEL_NAME_MAX);
    expect(guildNameError('ab')).toBe('too_short');
    expect(guildNameError('a')).toBe('too_short');
    expect(guildNameError('a'.repeat(Limits.GUILD_NAME_MAX + 1))).toBe('too_long');
  });

  it('adı slug\'a çevirmez, yalnızca boşlukları düzenler', () => {
    expect(normalizeGuildName('  Benim   Sunucum  ')).toBe('Benim Sunucum');
    expect(guildNameError('  Benim   Sunucum  ')).toBeNull();
  });
});
