export const SAMPLE_FILENAME = 'welcome.ts';

/** First-run document. Doubles as a quick tour of what the editor handles. */
export const SAMPLE_TEXT = `// pEditor — スマホでコードを書くためのエディタ
//
// 使い方:
//   タップ            キャレットを置く（下のハンドルをドラッグで微調整）
//   ダブルタップ      単語を選択 / トリプルタップで行を選択
//   長押し            単語を選択してハンドルを表示
//   ピンチ            文字サイズを変える（ページ全体は拡大しません）
//   ⌨ キー           OS のキーボードに切替（日本語入力はこちら）
//   #+= キー          記号レイヤー（括弧・演算子・-> => :: != ==）
//   ⋯ メニュー        折り返し・行番号・テーマ・キーボードの切替

interface Task {
  id: number;
  title: string;
  done: boolean;
}

const tasks: Task[] = [
  { id: 1, title: 'IME（日本語入力）の確認', done: true },
  { id: 2, title: 'ソフトキーボードで括弧を入力', done: false },
  { id: 3, title: '折り返しの長い行を編集してみる', done: false },
];

/**
 * 未完了のタスクだけを返す。この行はわざと長くしてあります —
 * 折り返しが有効なら、インデントを保ったまま次の行に続くはずです。
 */
export function pending(list: readonly Task[]): Task[] {
  return list.filter((task) => !task.done);
}

export function summarise(list: readonly Task[]): string {
  const remaining = pending(list).length;
  if (remaining === 0) return '全部おわり 🎉';
  return \`残り \${remaining} 件 / 全 \${list.length} 件\`;
}

console.log(summarise(tasks));
`;
