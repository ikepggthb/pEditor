/**
 * A Markdown reader.
 *
 * Small on purpose. A README on a phone is prose with headings, lists, links
 * and fenced code, and rendering exactly that well beats rendering all of
 * CommonMark badly — the alternative is a parser several times the size of the
 * editor it is bolted onto, downloaded on a phone connection to read one file.
 *
 * Nothing here trusts its input: every value that reaches the DOM does so as
 * text or through an attribute setter, never as markup. A repository is other
 * people's code, and a README is the part of it most likely to be hostile.
 */

interface Inline {
  text: string;
  code?: boolean;
  strong?: boolean;
  em?: boolean;
  href?: string;
}

const SAFE_LINK = /^(https?:|mailto:|#|\.|\/)/i;

/** Split one line into runs of styled text. */
function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ text: plain });
    plain = '';
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    // Code spans first: everything inside one is literal, including asterisks.
    let m = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (m) {
      flush();
      out.push({ text: m[2].trim(), code: true });
      i += m[0].length;
      continue;
    }

    m = /^!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (m) {
      flush();
      const href = m[2];
      // An image renders as its alt text: a reader on a phone connection is not
      // helped by pulling megabytes of badges out of a README.
      out.push(
        rest.startsWith('!')
          ? { text: m[1] || 'image' }
          : { text: m[1] || href, ...(SAFE_LINK.test(href) ? { href } : {}) },
      );
      i += m[0].length;
      continue;
    }

    m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (m) {
      flush();
      out.push({ text: m[2], strong: true });
      i += m[0].length;
      continue;
    }

    m = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (m) {
      flush();
      out.push({ text: m[2], em: true });
      i += m[0].length;
      continue;
    }

    m = /^<(https?:\/\/[^>\s]+)>/.exec(rest);
    if (m) {
      flush();
      out.push({ text: m[1], href: m[1] });
      i += m[0].length;
      continue;
    }

    plain += line[i];
    i++;
  }
  flush();
  return out;
}

function renderInlines(parent: HTMLElement, line: string): void {
  for (const run of inlines(line)) {
    let node: HTMLElement;
    if (run.href) {
      const link = document.createElement('a');
      link.href = run.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      node = link;
    } else if (run.code) {
      node = document.createElement('code');
    } else if (run.strong) {
      node = document.createElement('strong');
    } else if (run.em) {
      node = document.createElement('em');
    } else {
      parent.append(run.text);
      continue;
    }
    node.textContent = run.text;
    parent.appendChild(node);
  }
}

/** Render `source` into `host`, replacing whatever was there. */
export function renderMarkdown(source: string, host: HTMLElement): void {
  const doc = document.createDocumentFragment();
  const lines = source.split(/\r\n|\r|\n/);
  let i = 0;

  const el = (tag: string, className?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. Kept as a block that scrolls sideways rather than wrapping:
    // wrapped code is unreadable, and a snippet is meant to be copied whole.
    const fence = /^(\s*)(```+|~~~+)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[2][0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      const pre = el('pre', 'md-code');
      const code = el('code');
      code.textContent = body.join('\n');
      pre.appendChild(code);
      doc.appendChild(pre);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const node = el(`h${heading[1].length}`, 'md-h');
      renderInlines(node, heading[2].replace(/\s+#+\s*$/, ''));
      doc.appendChild(node);
      i++;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      doc.appendChild(el('hr', 'md-hr'));
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const quote = el('blockquote', 'md-quote');
      renderMarkdown(body.join('\n'), quote);
      doc.appendChild(quote);
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[2]);
      const list = el(ordered ? 'ol' : 'ul', 'md-list');
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        const li = el('li');
        // A task list is the one bit of GitHub flavour worth having: half the
        // READMEs worth reading are checklists.
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
        if (task) {
          const box = el('span', 'md-task');
          box.textContent = task[1] === ' ' ? '☐' : '☑';
          li.appendChild(box);
          renderInlines(li, task[2]);
        } else {
          renderInlines(li, item[3]);
        }
        list.appendChild(li);
        i++;
      }
      doc.appendChild(list);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // A paragraph runs to the next blank line or block opener.
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*)(```|~~~|#{1,6}\s|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    if (!body.length) {
      i++;
      continue;
    }
    const paragraph = el('p', 'md-p');
    renderInlines(paragraph, body.join(' '));
    doc.appendChild(paragraph);
  }

  host.replaceChildren(doc);
}

/** Whether this file is one the reader can show. */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
