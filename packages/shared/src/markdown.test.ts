import { describe, it, expect } from 'vitest';
import { parseMarkdown, toPlainText, type MarkdownNode } from './markdown.js';

/** Testleri okunur tutmak için ağacı kısa bir gösterime indirger. */
function shape(nodes: MarkdownNode[]): unknown {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'lineBreak':
        return '\\n';
      case 'code':
        return { code: node.value };
      case 'codeblock':
        return { block: node.value, lang: node.language };
      case 'link':
        return { link: node.url };
      case 'userMention':
        return { user: node.id };
      case 'roleMention':
        return { role: node.id };
      case 'everyoneMention':
        return { everyone: true };
      default:
        return { [node.type]: shape(node.children) };
    }
  });
}

describe("düz metin", () => {
  it("biçimlendirme yoksa tek metin düğümü", () => {
    expect(shape(parseMarkdown('merhaba dünya'))).toEqual(['merhaba dünya']);
  });

  it("boş girdi boş sonuç", () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it("satır sonları korunur", () => {
    expect(shape(parseMarkdown('bir\niki'))).toEqual(['bir', '\\n', 'iki']);
  });
});

describe("satır içi biçimlendirme", () => {
  it("kalın", () => {
    expect(shape(parseMarkdown('**kalın**'))).toEqual([{ bold: ['kalın'] }]);
  });

  it("italik: yıldız ve alt çizgi", () => {
    expect(shape(parseMarkdown('*a*'))).toEqual([{ italic: ['a'] }]);
    expect(shape(parseMarkdown('_a_'))).toEqual([{ italic: ['a'] }]);
  });

  it("altı çizili, çift alt çizgiden önce gelir", () => {
    expect(shape(parseMarkdown('__a__'))).toEqual([{ underline: ['a'] }]);
  });

  it("üstü çizili ve spoiler", () => {
    expect(shape(parseMarkdown('~~a~~'))).toEqual([{ strike: ['a'] }]);
    expect(shape(parseMarkdown('||gizli||'))).toEqual([{ spoiler: ['gizli'] }]);
  });

  it("iç içe biçimlendirme", () => {
    expect(shape(parseMarkdown('**kalın _ve italik_**'))).toEqual([
      { bold: ['kalın ', { italic: ['ve italik'] }] },
    ]);
  });

  it("üç yıldız: kalın + italik", () => {
    expect(shape(parseMarkdown('***ikisi***'))).toEqual([{ bold: [{ italic: ['ikisi'] }] }]);
  });

  it("metin arasında biçimlendirme", () => {
    expect(shape(parseMarkdown('bu **önemli** bir not'))).toEqual([
      'bu ',
      { bold: ['önemli'] },
      ' bir not',
    ]);
  });

  it("kapanmayan işaretçi düz metin kalır", () => {
    expect(shape(parseMarkdown('**kapanmadı'))).toEqual(['**kapanmadı']);
    expect(shape(parseMarkdown('yıldız * tek'))).toEqual(['yıldız * tek']);
  });

  it("boş işaretçi çifti biçimlendirme sayılmaz", () => {
    expect(shape(parseMarkdown('****'))).toEqual(['****']);
  });
});

describe("kod", () => {
  it("satır içi kod", () => {
    expect(shape(parseMarkdown('`kod`'))).toEqual([{ code: 'kod' }]);
  });

  it("kod içindeki işaretçiler yorumlanmaz", () => {
    expect(shape(parseMarkdown('`**kalın değil**`'))).toEqual([{ code: '**kalın değil**' }]);
  });

  it("kod bloğu dil etiketiyle", () => {
    expect(shape(parseMarkdown('```ts\nconst a = 1;\n```'))).toEqual([
      { block: 'const a = 1;', lang: 'ts' },
    ]);
  });

  it("kod bloğu dilsiz", () => {
    expect(shape(parseMarkdown('```\nsatır\n```'))).toEqual([{ block: 'satır', lang: null }]);
  });

  it("kod bloğu içindeki markdown korunur", () => {
    expect(shape(parseMarkdown('```\n**aynen**\n```'))).toEqual([
      { block: '**aynen**', lang: null },
    ]);
  });

  it("kapanmayan kod bloğu metin olarak kalır", () => {
    expect(shape(parseMarkdown('```açık kaldı'))).toEqual(['```açık kaldı']);
  });
});

describe("alıntı", () => {
  it("satır başındaki > alıntıdır", () => {
    expect(shape(parseMarkdown('> alıntı'))).toEqual([{ quote: ['alıntı'] }]);
  });

  it("satır ortasındaki > alıntı değildir", () => {
    expect(shape(parseMarkdown('a > b'))).toEqual(['a > b']);
  });

  it("alıntı içinde biçimlendirme çalışır", () => {
    expect(shape(parseMarkdown('> **önemli**'))).toEqual([{ quote: [{ bold: ['önemli'] }] }]);
  });
});

describe("bahsetmeler", () => {
  it("kullanıcı ve rol", () => {
    expect(shape(parseMarkdown('<@123> ve <@&456>'))).toEqual([
      { user: '123' },
      ' ve ',
      { role: '456' },
    ]);
  });

  it("@everyone", () => {
    expect(shape(parseMarkdown('selam @everyone'))).toEqual(['selam ', { everyone: true }]);
  });

  it("bozuk bahsetme biçimi düz metin kalır", () => {
    expect(shape(parseMarkdown('<@abc>'))).toEqual(['<@abc>']);
  });
});

describe("bağlantılar", () => {
  it("otomatik bağlantı", () => {
    expect(shape(parseMarkdown('https://ornek.com'))).toEqual([{ link: 'https://ornek.com' }]);
  });

  it("cümle sonu noktalaması bağlantıya dahil edilmez", () => {
    expect(shape(parseMarkdown('bak https://ornek.com.'))).toEqual([
      'bak ',
      { link: 'https://ornek.com' },
      '.',
    ]);
  });

  it("javascript: şeması bağlantı sayılmaz", () => {
    expect(shape(parseMarkdown('javascript:alert(1)'))).toEqual(['javascript:alert(1)']);
  });
});

describe("güvenlik", () => {
  it("HTML metin olarak kalır, düğüme dönüşmez", () => {
    const nodes = parseMarkdown('<script>alert(1)</script>');
    expect(shape(nodes)).toEqual(['<script>alert(1)</script>']);
    // Tek tip metin düğümü: render tarafı bunu React metni olarak basar.
    expect(nodes.every((node) => node.type === 'text')).toBe(true);
  });

  it("img onerror denemesi metin kalır", () => {
    expect(shape(parseMarkdown('<img src=x onerror=alert(1)>'))).toEqual([
      '<img src=x onerror=alert(1)>',
    ]);
  });

  it("derin iç içe girdi makul sürede biter", () => {
    const started = Date.now();
    parseMarkdown('*'.repeat(200) + 'a' + '*'.repeat(200));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("uzun metin makul sürede ayrıştırılır", () => {
    const started = Date.now();
    parseMarkdown('kelime **kalın** `kod` https://a.com \n'.repeat(500));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("toPlainText", () => {
  it("işaretleri atar", () => {
    expect(toPlainText(parseMarkdown('**kalın** ve `kod`'))).toBe('kalın ve kod');
  });

  it("bahsetmeleri okunur biçime çevirir", () => {
    expect(toPlainText(parseMarkdown('<@1> selam'))).toBe('@kullanıcı selam');
  });
});
