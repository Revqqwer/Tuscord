/**
 * Bahsetme (mention) ayrıştırma.
 *
 * İstemci bahsetmeleri Discord biçiminde gönderir:
 *   <@123>   kullanıcı
 *   <@&456>  rol
 *   @everyone
 *
 * Sunucu içeriği yeniden ayrıştırır — istemcinin gönderdiği mention listesine
 * GÜVENİLMEZ. Aksi halde bir istemci "@everyone" yazmadan herkese bildirim
 * gönderebilirdi.
 */

const USER_MENTION = /<@(\d{1,20})>/g;
const ROLE_MENTION = /<@&(\d{1,20})>/g;
const EVERYONE_MENTION = /(^|\s)@everyone(\s|$)/;

export interface ParsedMentions {
  users: string[];
  roles: string[];
  everyone: boolean;
}

export function parseMentions(content: string, canMentionEveryone: boolean): ParsedMentions {
  const users = new Set<string>();
  const roles = new Set<string>();

  for (const match of content.matchAll(USER_MENTION)) {
    if (match[1]) users.add(match[1]);
  }
  for (const match of content.matchAll(ROLE_MENTION)) {
    if (match[1]) roles.add(match[1]);
  }

  return {
    users: [...users],
    roles: [...roles],
    // İzni yoksa metin görünür ama bildirim tetiklenmez.
    everyone: canMentionEveryone && EVERYONE_MENTION.test(content),
  };
}

/**
 * Sunucu genelindeki kelime filtresi.
 * Basit alt dize eşleşmesi + Türkçe küçük harf normalizasyonu.
 * Amaç mükemmel bir filtre değil — moderatörün en sık gelen spam kalıbını
 * hızlıca kapatabilmesi.
 */
export function violatesWordFilter(content: string, filter: readonly string[]): string | null {
  if (filter.length === 0) return null;
  const normalized = content.toLocaleLowerCase('tr');
  for (const word of filter) {
    if (word && normalized.includes(word.toLocaleLowerCase('tr'))) return word;
  }
  return null;
}
