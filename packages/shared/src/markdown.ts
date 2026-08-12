/**
 * Mesaj metni ayrıştırıcı — Discord'un markdown alt kümesi.
 *
 * Tasarım kararı: dış kütüphane yok ve **HTML üretilmiyor**. Ayrıştırıcı
 * yalnızca bir düğüm ağacı döndürür, render tarafı bunu React elemanlarına
 * çevirir. `dangerouslySetInnerHTML` hiç kullanılmadığı için kullanıcı metni
 * hiçbir noktada HTML olarak yorumlanamaz — XSS yüzeyi kapalı.
 *
 * Desteklenen:
 *   **kalın**  *italik*  _italik_  __altı çizili__  ~~üstü çizili~~
 *   `satır içi kod`   ```kod bloğu```   > alıntı   ||spoiler||
 *   <@123> kullanıcı   <@&456> rol   @everyone
 *   http(s):// bağlantıları (otomatik)
 */

export type MarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: MarkdownNode[] }
  | { type: 'italic'; children: MarkdownNode[] }
  | { type: 'underline'; children: MarkdownNode[] }
  | { type: 'strike'; children: MarkdownNode[] }
  | { type: 'spoiler'; children: MarkdownNode[] }
  | { type: 'code'; value: string }
  | { type: 'codeblock'; value: string; language: string | null }
  | { type: 'quote'; children: MarkdownNode[] }
  | { type: 'link'; url: string }
  | { type: 'userMention'; id: string }
  | { type: 'roleMention'; id: string }
  | { type: 'everyoneMention' }
  | { type: 'lineBreak' };

/**
 * Satır içi biçimlendirme kuralları.
 * Sıra önemli: uzun işaretçiler kısa olanlardan ÖNCE denenmeli
 * (`**` , `*`'dan önce; `__` , `_`'den önce).
 */
const INLINE_RULES: ReadonlyArray<{
  marker: string;
  type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'boldItalic';
}> = [
  // `***a***` kalın + italik. `**`'dan önce denenmeli, yoksa `**` eşleşip
  // arta kalan tek `*` düz metne düşer.
  { marker: '***', type: 'boldItalic' },
  { marker: '**', type: 'bold' },
  { marker: '__', type: 'underline' },
  { marker: '~~', type: 'strike' },
  { marker: '||', type: 'spoiler' },
  { marker: '*', type: 'italic' },
  { marker: '_', type: 'italic' },
];

const URL_PATTERN = /https?:\/\/[^\s<>()]+/;
const USER_MENTION = /^<@(\d{1,20})>/;
const ROLE_MENTION = /^<@&(\d{1,20})>/;

/** Ayrıştırma derinliği sınırı: `***a***` gibi iç içe yapılar sonsuza gitmesin. */
const MAX_DEPTH = 8;

export function parseMarkdown(input: string): MarkdownNode[] {
  return parseBlocks(input, 0);
}

/** Kod bloğu ve alıntı gibi satır bazlı yapılar. */
function parseBlocks(input: string, depth: number): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let rest = input;

  while (rest.length > 0) {
    // ```dil\nkod``` — kod bloğu her şeyi olduğu gibi alır, içinde ayrıştırma yapılmaz.
    if (rest.startsWith('```')) {
      const end = rest.indexOf('```', 3);
      if (end !== -1) {
        const raw = rest.slice(3, end);
        const newline = raw.indexOf('\n');
        // İlk satır dil adı olabilir: ```ts\n...
        const hasLanguage = newline !== -1 && /^[a-zA-Z0-9+#-]{1,20}$/.test(raw.slice(0, newline));
        const content = hasLanguage ? raw.slice(newline + 1) : raw;
        nodes.push({
          type: 'codeblock',
          language: hasLanguage ? raw.slice(0, newline) : null,
          // Çitten hemen sonraki ve kapanıştan hemen önceki satır sonu
          // yazım kolaylığıdır, içeriğin parçası değil.
          value: content.replace(/^\n/, '').replace(/\n$/, ''),
        });
        rest = rest.slice(end + 3);
        continue;
      }
    }

    // Satır başındaki `> ` alıntı işareti.
    const atLineStart = nodes.length === 0 || nodes[nodes.length - 1]?.type === 'lineBreak';
    if (atLineStart && /^>\s/.test(rest)) {
      const lineEnd = rest.indexOf('\n');
      const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
      nodes.push({
        type: 'quote',
        children: depth < MAX_DEPTH ? parseInline(line.replace(/^>\s/, ''), depth + 1) : [],
      });
      rest = lineEnd === -1 ? '' : rest.slice(lineEnd + 1);
      if (rest.length > 0) nodes.push({ type: 'lineBreak' });
      continue;
    }

    // Bir sonraki blok yapısına kadar olan kısmı satır içi ayrıştır.
    const nextBlock = findNextBlockStart(rest);
    const chunk = nextBlock === -1 ? rest : rest.slice(0, nextBlock);
    nodes.push(...parseInline(chunk, depth));
    rest = nextBlock === -1 ? '' : rest.slice(nextBlock);
  }

  return nodes;
}

/**
 * Sıradaki blok yapısının (kod bloğu / alıntı satırı) başlangıç konumu.
 *
 * Arama 1'den başlar: konum 0'daki çit çağıran tarafta zaten denenmiş ve
 * kapanmadığı için düz metne düşmüştür. 0'ı döndürmek, girdiyi hiç
 * tüketmeden aynı noktaya dönmek — yani sonsuz döngü demek olurdu.
 */
function findNextBlockStart(input: string): number {
  const fence = input.indexOf('```', 1);
  let quote = -1;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\n' && /^>\s/.test(input.slice(i + 1))) {
      quote = i + 1;
      break;
    }
  }
  if (fence === -1) return quote;
  if (quote === -1) return fence;
  return Math.min(fence, quote);
}

function parseInline(input: string, depth: number): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer.length > 0) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < input.length) {
    const rest = input.slice(index);

    if (rest.startsWith('\n')) {
      flush();
      nodes.push({ type: 'lineBreak' });
      index += 1;
      continue;
    }

    // `satır içi kod` — içindeki işaretçiler yorumlanmaz.
    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1);
      if (end > 1) {
        flush();
        nodes.push({ type: 'code', value: rest.slice(1, end) });
        index += end + 1;
        continue;
      }
    }

    const userMatch = USER_MENTION.exec(rest);
    if (userMatch?.[1]) {
      flush();
      nodes.push({ type: 'userMention', id: userMatch[1] });
      index += userMatch[0].length;
      continue;
    }

    const roleMatch = ROLE_MENTION.exec(rest);
    if (roleMatch?.[1]) {
      flush();
      nodes.push({ type: 'roleMention', id: roleMatch[1] });
      index += roleMatch[0].length;
      continue;
    }

    if (rest.startsWith('@everyone')) {
      flush();
      nodes.push({ type: 'everyoneMention' });
      index += '@everyone'.length;
      continue;
    }

    if (rest.startsWith('http://') || rest.startsWith('https://')) {
      const match = URL_PATTERN.exec(rest);
      if (match && match.index === 0) {
        flush();
        // Sondaki noktalama bağlantıya dahil edilmez: "bak https://a.com." gibi.
        const url = match[0].replace(/[.,;:!?]+$/, '');
        nodes.push({ type: 'link', url });
        index += url.length;
        continue;
      }
    }

    if (depth < MAX_DEPTH) {
      const styled = matchInlineRule(rest, depth);
      if (styled) {
        flush();
        nodes.push(styled.node);
        index += styled.length;
        continue;
      }
    }

    buffer += input[index];
    index += 1;
  }

  flush();
  return nodes;
}

function matchInlineRule(
  rest: string,
  depth: number,
): { node: MarkdownNode; length: number } | null {
  for (const rule of INLINE_RULES) {
    if (!rest.startsWith(rule.marker)) continue;

    const closing = rest.indexOf(rule.marker, rule.marker.length);
    if (closing === -1) continue;

    const inner = rest.slice(rule.marker.length, closing);
    // Boş işaretçi çifti (`****`) biçimlendirme değil, düz metindir.
    if (inner.length === 0) continue;

    const children = parseInline(inner, depth + 1);
    return {
      node:
        rule.type === 'boldItalic'
          ? { type: 'bold', children: [{ type: 'italic', children }] }
          : { type: rule.type, children },
      length: closing + rule.marker.length,
    };
  }
  return null;
}

/** Biçimlendirme işaretlerini atıp düz metni verir (bildirim önizlemesi, sekme başlığı). */
export function toPlainText(nodes: readonly MarkdownNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
        case 'codeblock':
          return node.value;
        case 'link':
          return node.url;
        case 'lineBreak':
          return ' ';
        case 'userMention':
          return '@kullanıcı';
        case 'roleMention':
          return '@rol';
        case 'everyoneMention':
          return '@everyone';
        default:
          return toPlainText(node.children);
      }
    })
    .join('');
}
