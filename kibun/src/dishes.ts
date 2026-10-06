/** The catalogue. Photos are Unsplash photo ids (see photo.ts); a dish
    without one is set as a typographic plate instead of a picture. */

export type Tag =
  // cuisine
  | 'jp' | 'cn' | 'kr' | 'sea' | 'in' | 'it' | 'eu' | 'us' | 'mx' | 'cafe'
  // form
  | 'noodle' | 'rice' | 'bread' | 'soup' | 'plate' | 'sweet'
  // character
  | 'rich' | 'light' | 'spicy' | 'warm' | 'cold' | 'meat' | 'fish' | 'veg'
  | 'fried' | 'grilled' | 'hearty' | 'street';

type Group = 'cuisine' | 'form' | 'trait';

interface TagInfo {
  group: Group;
  /** Short label, used where nothing has been kept yet. */
  label: string;
  /** Why a dish follows from what was kept: the line above its name. */
  because: string;
}

export const TAGS: Record<Tag, TagInfo> = {
  jp: { group: 'cuisine', label: '和食', because: '和の流れで' },
  cn: { group: 'cuisine', label: '中華', because: '中華の流れで' },
  kr: { group: 'cuisine', label: '韓国', because: '韓国の流れで' },
  sea: { group: 'cuisine', label: 'アジアン', because: 'アジアの流れで' },
  in: { group: 'cuisine', label: 'スパイス', because: 'スパイスの流れで' },
  it: { group: 'cuisine', label: 'イタリアン', because: 'イタリアンの流れで' },
  eu: { group: 'cuisine', label: '洋食', because: '洋食の流れで' },
  us: { group: 'cuisine', label: 'アメリカン', because: 'アメリカンの流れで' },
  mx: { group: 'cuisine', label: 'メキシカン', because: 'メキシカンの流れで' },
  cafe: { group: 'cuisine', label: 'カフェ', because: 'カフェの気分で' },

  noodle: { group: 'form', label: '麺', because: '麺の気分が続くなら' },
  rice: { group: 'form', label: 'ごはんもの', because: 'ごはんもの続きで' },
  bread: { group: 'form', label: 'パン', because: 'パンの気分で' },
  soup: { group: 'form', label: 'スープ', because: '汁ものつながり' },
  plate: { group: 'form', label: '一皿', because: 'しっかり一皿' },
  sweet: { group: 'form', label: '甘いもの', because: '甘いもの続きで' },

  rich: { group: 'trait', label: 'こってり', because: 'こってり路線で' },
  light: { group: 'trait', label: 'あっさり', because: 'あっさりめで' },
  spicy: { group: 'trait', label: '辛い', because: 'もっと辛く' },
  warm: { group: 'trait', label: '温かい', because: '温かいものを' },
  cold: { group: 'trait', label: 'ひんやり', because: 'ひんやりつながり' },
  meat: { group: 'trait', label: '肉', because: '肉の気分に' },
  fish: { group: 'trait', label: '魚介', because: '魚介の流れで' },
  veg: { group: 'trait', label: '野菜', because: '野菜をたっぷり' },
  fried: { group: 'trait', label: '揚げもの', because: '揚げものつながり' },
  grilled: { group: 'trait', label: '焼きもの', because: '香ばしさつながり' },
  hearty: { group: 'trait', label: 'がっつり', because: 'がっつり路線で' },
  street: { group: 'trait', label: '気軽', because: '気軽にいくなら' },
};

export const GROUP_WEIGHT: Record<Group, number> = { cuisine: 1, form: 1, trait: 0.7 };

export interface Dish {
  id: string;
  name: string;
  en: string;
  blurb: string;
  tags: Tag[];
  /** Unsplash photo id, e.g. "photo-1569718212165-3a8278d5f624". */
  photo?: string;
  /** Roughly the photo's dominant colour: shown while it loads. */
  tone: string;
}

const d = (
  id: string, name: string, en: string, blurb: string,
  tags: Tag[], tone: string, photo?: string,
): Dish => ({ id, name, en, blurb, tags, tone, photo });

export const DISHES: Dish[] = [
  d('ramen', 'ラーメン', 'Ramen', '濃いスープに、太めの麺。夜に強い一杯。',
    ['jp', 'noodle', 'rich', 'warm', 'meat', 'hearty'], '#a4743f', 'photo-1569718212165-3a8278d5f624'),
  d('chuka-soba', '中華そば', 'Chuka Soba', '澄んだ醤油に細麺。気取らない、昔ながらの味。',
    ['jp', 'noodle', 'light', 'warm', 'street'], '#8c6a44', 'photo-1557872943-16a5ac26437e'),
  d('udon', 'うどん', 'Udon', 'だしの香りと、もちもちの麺。疲れた日のやさしさ。',
    ['jp', 'noodle', 'light', 'warm'], '#c9a774', 'photo-1618841557871-b4664fbf0cb3'),
  d('sushi', '寿司', 'Sushi', '迷ったら、ちょっといい寿司という選択。',
    ['jp', 'rice', 'fish', 'light', 'cold'], '#b65a45', 'photo-1579871494447-9811cf80d66c'),
  d('oyakodon', '親子丼', 'Oyakodon', 'とろとろの卵と鶏。丼ひとつで完結する安心感。',
    ['jp', 'rice', 'meat', 'warm', 'street'], '#d2a447'),
  d('tonkatsu', 'とんかつ', 'Tonkatsu', '厚切りをさくっと。キャベツとソースで、まっすぐな満足。',
    ['jp', 'plate', 'fried', 'meat', 'hearty', 'rich'], '#b98545'),
  d('tempura-soba', '天ぷらそば', 'Tempura Soba', '香るそばに、揚げたての海老。',
    ['jp', 'noodle', 'fried', 'fish', 'warm'], '#7d5b3a'),
  d('yakizakana', '焼き魚定食', 'Grilled Fish Set', '皮目の焼き色、白いごはん、味噌汁。整う一食。',
    ['jp', 'rice', 'fish', 'grilled', 'light', 'warm'], '#8a7a62'),

  d('dimsum', '点心', 'Dim Sum', '蒸籠をあける瞬間から始まる、少しずつのたのしみ。',
    ['cn', 'plate', 'meat', 'warm', 'light'], '#c8b48c', 'photo-1563245372-f21724e3856d'),
  d('xiaolongbao', '小籠包', 'Xiaolongbao', '薄皮の中に、熱いスープ。れんげで受けて。',
    ['cn', 'soup', 'meat', 'warm'], '#d7c6a3', 'photo-1496116218417-1a781b1c416c'),
  d('fried-rice', 'チャーハン', 'Fried Rice', '強火でぱらり。シンプルなのに、ときどき無性に。',
    ['cn', 'rice', 'hearty', 'warm', 'street'], '#c9963f', 'photo-1603133872878-684f208fb84b'),

  d('bibimbap', 'ビビンバ', 'Bibimbap', '全部まぜて、コチュジャンで。野菜も辛さも一度に。',
    ['kr', 'rice', 'spicy', 'veg', 'warm'], '#b5532f', 'photo-1590301157890-4810ed352733'),
  d('pad-thai', 'パッタイ', 'Pad Thai', '甘酸っぱくて香ばしい、タイの焼きそば。',
    ['sea', 'noodle', 'street', 'warm', 'fish'], '#c4813f', 'photo-1559314809-0d155014e29e'),
  d('pho', 'フォー', 'Phở', '米の麺と澄んだスープ。ハーブとライムで軽やかに。',
    ['sea', 'noodle', 'light', 'warm', 'meat'], '#b99668', 'photo-1582878826629-29b7ad1cdc43'),
  d('thai-curry', 'タイカレー', 'Thai Curry', 'ココナッツの甘さのあとに、じわっと辛い。',
    ['sea', 'rice', 'spicy', 'warm', 'rich'], '#a8862e', 'photo-1455619452474-d2be8b1e70cd'),
  d('indian-curry', 'インドカレー', 'Indian Curry', '何種類ものスパイスが重なる、香りのごちそう。',
    ['in', 'rice', 'spicy', 'warm', 'rich', 'meat'], '#a64a1f', 'photo-1585937421612-70a008356fbe'),

  d('pizza', 'ピザ', 'Pizza', '焼きたてを手で。みんなで囲むと、なおいい。',
    ['it', 'bread', 'rich', 'warm', 'hearty'], '#b0532c', 'photo-1565299624946-b28f40a0ae38'),
  d('margherita', 'マルゲリータ', 'Margherita', 'トマト、モッツァレラ、バジル。三つだけで完璧。',
    ['it', 'bread', 'warm', 'veg', 'light'], '#c0452e', 'photo-1574071318508-1cdbab80d002'),
  d('pasta', 'スパゲッティ', 'Spaghetti', 'くるくる巻いて、ソースをぬぐう。',
    ['it', 'noodle', 'warm', 'veg'], '#b5432a', 'photo-1621996346565-e3dbc646d9a9'),
  d('carbonara', 'カルボナーラ', 'Carbonara', '卵とチーズと胡椒。濃厚なのに、止まらない。',
    ['it', 'noodle', 'rich', 'warm', 'meat'], '#d1b27a', 'photo-1612874742237-6526221588e3'),
  d('lasagna', 'ラザニア', 'Lasagna', '何層にも重ねたソースとチーズ。オーブンの幸福。',
    ['it', 'plate', 'rich', 'warm', 'meat', 'hearty'], '#a4472b', 'photo-1574894709920-11b28e7367e3'),
  d('risotto', 'リゾット', 'Risotto', 'きのこの香りを米に含ませて、ゆっくり。',
    ['it', 'rice', 'rich', 'warm', 'veg'], '#c2a77c', 'photo-1476124369491-e7addf5db371'),

  d('paella', 'パエリア', 'Paella', '鍋ごと出てくる、魚介とサフランのごはん。',
    ['eu', 'rice', 'fish', 'warm', 'hearty'], '#c88a32', 'photo-1534080564583-6be75777b70a'),
  d('salmon', 'サーモンのグリル', 'Grilled Salmon', '皮はパリッと、身はしっとり。',
    ['eu', 'plate', 'fish', 'grilled', 'light'], '#c97b52', 'photo-1467003909585-2f8a72700288'),
  d('grill-plate', 'グリルプレート', 'Mixed Grill', '肉を焼いて、付け合わせを並べて。食べる元気が出る皿。',
    ['eu', 'plate', 'meat', 'grilled', 'hearty'], '#6b4a33', 'photo-1504674900247-0877df9cc836'),
  d('steak', 'ステーキ', 'Steak', '焼き目の香ばしさと、赤い断面。今日はご褒美。',
    ['us', 'plate', 'meat', 'grilled', 'hearty', 'rich'], '#5a3a2a', 'photo-1600891964092-4316c288032e'),
  d('soup', '野菜のスープ', 'Vegetable Soup', 'ことこと煮た野菜で、体の内側から温まる。',
    ['eu', 'soup', 'veg', 'light', 'warm'], '#b8743e', 'photo-1547592180-85f173990554'),

  d('burger', 'ハンバーガー', 'Burger', '両手でつかんで、かぶりつく。',
    ['us', 'bread', 'meat', 'rich', 'hearty', 'street'], '#8c5a33', 'photo-1568901346375-23c9450c58cd'),
  d('cheeseburger', 'チーズバーガー', 'Cheeseburger', 'とろけたチーズが、肉汁をもう一段おいしくする。',
    ['us', 'bread', 'meat', 'rich', 'street', 'fried'], '#a26b34', 'photo-1550547660-d9450f859349'),
  d('fried-chicken', 'フライドチキン', 'Fried Chicken', 'ざくざくの衣。考えるより先に手が出る。',
    ['us', 'plate', 'fried', 'meat', 'street', 'rich'], '#b0742f', 'photo-1626082927389-6cd097cdc6ec'),
  d('ribs', 'スペアリブ', 'Spare Ribs', '甘辛いソースで、骨までしゃぶる。',
    ['us', 'plate', 'meat', 'grilled', 'rich', 'hearty'], '#6a3322', 'photo-1544025162-d76694265947'),
  d('skewers', 'BBQ串焼き', 'BBQ Skewers', '炭火の煙ごと味わう、串の肉と野菜。',
    ['us', 'plate', 'meat', 'grilled', 'street'], '#4f3326', 'photo-1555939594-58d7cb561ad1'),
  d('tacos', 'タコス', 'Tacos', 'トルティーヤにのせて、ライムをしぼって。',
    ['mx', 'bread', 'meat', 'spicy', 'street'], '#b5762f', 'photo-1565299585323-38d6b0865b47'),
  d('burrito', 'ブリトー', 'Burrito', 'ごはんも豆も肉も巻き込んだ、ずしりとした一本。',
    ['mx', 'bread', 'meat', 'hearty', 'spicy', 'street'], '#a9874f', 'photo-1626700051175-6818013e1d4f'),

  d('grain-bowl', 'グレインボウル', 'Grain Bowl', '穀物と野菜をたっぷり。軽いのに、ちゃんと満ちる。',
    ['cafe', 'rice', 'veg', 'light', 'cold'], '#7d8c4a', 'photo-1512621776951-a57141f2eefd'),
  d('salad-bowl', 'サラダボウル', 'Salad Bowl', '色とりどりを、ざっくり混ぜて。',
    ['cafe', 'plate', 'veg', 'light', 'cold'], '#6f8a45', 'photo-1546069901-ba9599a7e63c'),
  d('avocado-toast', 'アボカドトースト', 'Avocado Toast', 'カリッと焼いたパンに、なめらかなアボカド。',
    ['cafe', 'bread', 'veg', 'light'], '#8a9a52', 'photo-1541519227354-08fa5d50c44d'),
  d('morning-plate', 'モーニングプレート', 'Breakfast Plate', '卵とトーストの、遅めの朝ごはん。',
    ['cafe', 'bread', 'light', 'warm'], '#c4a26d', 'photo-1525351484163-7529414344d8'),
  d('sandwich', 'クラブサンド', 'Club Sandwich', '何層も重ねて、斜めに切る。',
    ['cafe', 'bread', 'meat', 'light', 'cold', 'street'], '#b99a6a', 'photo-1528735602780-2552fd46c7af'),

  d('pancakes', 'パンケーキ', 'Pancakes', 'ふわふわを重ねて、ベリーとシロップ。',
    ['cafe', 'sweet', 'warm'], '#c58d4c', 'photo-1567620905732-2d1ec7ab7445'),
  d('french-toast', 'フレンチトースト', 'French Toast', '卵液をたっぷり吸わせて、バターで焼く。',
    ['cafe', 'sweet', 'warm', 'rich'], '#b98444', 'photo-1484723091739-30a097e8f929'),
  d('chocolate-cake', 'チョコレートケーキ', 'Chocolate Cake', '濃いチョコを、ゆっくり一口ずつ。',
    ['cafe', 'sweet', 'rich'], '#4a2c22', 'photo-1578985545062-69928b1d9587'),
  d('parfait', 'パフェ', 'Parfait', 'ヨーグルトと果物を重ねた、軽やかなグラス。',
    ['cafe', 'sweet', 'cold', 'light'], '#d9c3b0', 'photo-1488477181946-6428a0291777'),
  d('donuts', 'ドーナツ', 'Doughnuts', '箱をあけて、どれにするか迷う時間ごと。',
    ['us', 'sweet', 'fried', 'street'], '#d29a7a', 'photo-1551024601-bec78aea704b'),
  d('ice-cream', 'アイスクリーム', 'Ice Cream', '夕食のかわりにアイス。そういう日もある。',
    ['us', 'sweet', 'cold', 'street'], '#e2c6b2', 'photo-1497034825429-c343d7c6a68f'),
];

export const BY_ID: ReadonlyMap<string, Dish> = new Map(DISHES.map((x) => [x.id, x]));
