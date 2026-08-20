/**
 * Sunucu/kanal simgesi düşmesi (görsel yoksa) için baş harf kısaltması.
 *
 * Tek kelimeyse o kelimenin ilk harfi ("Discord" → "D"), iki veya daha fazla
 * kelimeyse ilk iki kelimenin baş harfleri ("Genel Sunucu" → "GS"). Grup
 * DM etiketleri gibi virgülle ayrılmış isimlerde de kelime sayılır, yani
 * "Ali, Veli" için ilk iki "kelime" Ali ve Veli olur.
 */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/[\s,]+/).filter(Boolean);
  if (words.length <= 1) return (words[0]?.[0] ?? '').toLocaleUpperCase('tr');
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toLocaleUpperCase('tr');
}
