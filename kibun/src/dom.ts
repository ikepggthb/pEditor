type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

/** Build an element. `on*` props become listeners; `false`/`undefined` props are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Props | null = null, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const WEEKDAY = '日月火水木金土';

/** "10月6日 火曜の夜" — the masthead's dateline. */
export function dateline(now = new Date()): string {
  const hr = now.getHours();
  const part = hr < 5 ? '夜ふけ' : hr < 11 ? '朝' : hr < 15 ? '昼' : hr < 17 ? 'おやつ' : '夜';
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY[now.getDay()]}曜の${part}`;
}

/** Lets CSS size a dish name to fit its line: see `.name[style]`. */
export const chars = (name: string) => `--chars:${[...name].length}`;

export const pad2 = (n: number) => String(n).padStart(2, '0');
