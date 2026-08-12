/**
 * Ayrıştırılmış mesaj ağacını React elemanlarına çevirir.
 *
 * `dangerouslySetInnerHTML` yok: her metin parçası React metin düğümü olarak
 * basılır, yani kullanıcı içeriği hiçbir noktada HTML olarak yorumlanmaz.
 */

import { useState, type ReactNode } from 'react';
import { parseMarkdown, type MarkdownNode } from '@tuscord/shared';

interface Props {
  content: string;
  /** Bahsetmeleri isimle göstermek için: id → görünen ad. */
  userNames: Map<string, string>;
  roleNames: Map<string, string>;
  /** İstek sahibi bahsedilenler arasında mı — vurguyu güçlendirir. */
  mentionsMe: boolean;
}

export function MessageContent({ content, userNames, roleNames, mentionsMe }: Props) {
  const nodes = parseMarkdown(content);
  return <>{nodes.map((node, index) => render(node, index, userNames, roleNames, mentionsMe))}</>;
}

function render(
  node: MarkdownNode,
  key: number,
  userNames: Map<string, string>,
  roleNames: Map<string, string>,
  mentionsMe: boolean,
): ReactNode {
  const children = (list: MarkdownNode[]) =>
    list.map((child, index) => render(child, index, userNames, roleNames, mentionsMe));

  switch (node.type) {
    case 'text':
      return node.value;

    case 'lineBreak':
      return <br key={key} />;

    case 'bold':
      return <strong key={key}>{children(node.children)}</strong>;

    case 'italic':
      return <em key={key}>{children(node.children)}</em>;

    case 'underline':
      return <u key={key}>{children(node.children)}</u>;

    case 'strike':
      return <s key={key}>{children(node.children)}</s>;

    case 'spoiler':
      return <Spoiler key={key}>{children(node.children)}</Spoiler>;

    case 'code':
      return (
        <code
          key={key}
          className="rounded bg-[var(--color-surface-3)] px-1 py-0.5 font-mono text-[0.9em]"
        >
          {node.value}
        </code>
      );

    case 'codeblock':
      return (
        <pre
          key={key}
          className="my-1 overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3"
        >
          {node.language && (
            <div className="mb-1 text-xs text-[var(--color-ink-faint)]">{node.language}</div>
          )}
          <code className="font-mono text-sm">{node.value}</code>
        </pre>
      );

    case 'quote':
      return (
        <blockquote
          key={key}
          className="my-0.5 border-l-4 border-[var(--color-surface-3)] pl-3 text-[var(--color-ink-muted)]"
        >
          {children(node.children)}
        </blockquote>
      );

    case 'link':
      return (
        <a
          key={key}
          href={node.url}
          target="_blank"
          // noopener: açılan sayfa window.opener üzerinden bizi yönlendiremesin.
          rel="noreferrer noopener"
          className="text-[var(--color-brand)] hover:underline"
        >
          {node.url}
        </a>
      );

    case 'userMention':
      return (
        <Mention key={key} highlighted={mentionsMe}>
          @{userNames.get(node.id) ?? 'bilinmeyen'}
        </Mention>
      );

    case 'roleMention':
      return (
        <Mention key={key} highlighted={mentionsMe}>
          @{roleNames.get(node.id) ?? 'rol'}
        </Mention>
      );

    case 'everyoneMention':
      return (
        <Mention key={key} highlighted>
          @everyone
        </Mention>
      );
  }
}

function Mention({ children, highlighted }: { children: ReactNode; highlighted: boolean }) {
  return (
    <span
      className={`rounded px-1 font-medium ${
        highlighted
          ? 'bg-[var(--color-brand)]/25 text-[var(--color-brand)]'
          : 'bg-[var(--color-surface-3)] text-[var(--color-ink)]'
      }`}
    >
      {children}
    </span>
  );
}

/** Tıklanana kadar gizli metin. */
function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setRevealed(true);
      }}
      className={
        revealed
          ? 'rounded bg-[var(--color-surface-3)] px-0.5'
          : 'cursor-pointer rounded bg-[var(--color-surface-3)] px-0.5 text-transparent select-none'
      }
    >
      {children}
    </span>
  );
}
