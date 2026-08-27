/**
 * 背景のグラフの骨格（M11 / Issue #63）。**組み立て時に一度だけ作る純粋な部分。**
 *
 * 参考は AviUtl の GetColor（対象を分割して点を撒き、近い点どうしを線で結ぶ
 * スクリプト）。ただし GetColor をそのまま真似ると全面に点が散って
 * **連結成分がいくつにも割れる**ので、この作品では「画面の中央に据えた、
 * 連結成分が 1 つの塊」を要件にした。
 *
 * ここが持つのは**位置と辺**だけ。どこにどれだけの大きさで置くか、どう漂わせるか、
 * どんな濃さで描くかは `graph-field.ts` の担当。分けているのは、骨格の正しさ
 * （連結しているか・辺が重複していないか）が canvas 抜きで検査できる性質だから。
 *
 * ```
 * scatterDisc ──┐
 *               ├─ createGraphShape ─→ { nodes, edges, degrees }
 * spanningTree ─┤
 * nearestEdges ─┘
 * ```
 */

/** 塊の中の位置。原点が塊の中心で、半径は 1 前後に収まる（画面の大きさに依らない） */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 辺。点の番号の対で持つ。`dedupeEdges` を通したものは必ず `a < b` */
export type Edge = readonly [a: number, b: number];

export interface GraphShape {
  readonly nodes: readonly Point[];
  readonly edges: readonly Edge[];
  /** 各点に集まっている辺の本数。点の大きさはここから決める（`graph-field.ts`） */
  readonly degrees: readonly number[];
}

/**
 * 点の数。**120 は「グラフとして読める」下限に近い。**
 *
 * 第 2 稿（全面に散らす案）では 220 個あったが、あれは点そのものが背景の質感を
 * 作る形だった。中央の 1 塊にすると点は「節点」として個々に読まれるので、
 * 多いほど良いわけではない — 増やすほど辺が密になり、網からただの面へ潰れる。
 */
const NODE_COUNT = 120;

/**
 * 塊の中心への寄り具合。**0.5 なら面積あたり一様**（円盤に均等に撒かれる）。
 *
 * それより大きくすると中心へ寄る。中心が密なほど「1 つの塊」として読め、
 * 一様に近いほど円い面に見える。0.72 は目で見て決めた値。
 */
const RADIAL_BIAS = 0.72;

/**
 * 横への引き伸ばし。画面が 16:9 なので、真円だと左右に余白が余る。
 *
 * **縦ではなく横を伸ばす**こと。縦を伸ばすと塊が上下で切れる（大きさを決めるのは
 * 短い辺なので、縦へはもともと余裕が無い）。
 */
export const DISC_ASPECT = 1.24;

/**
 * 全域木に足す近傍の本数。**足す理由は、木のままだと輪が 1 つも無いから。**
 *
 * 全域木は連結を保証するが、辺の数は必ず n-1 本で閉路を持たない ＝ 見た目が
 * 「枝」になる。網として読ませるには輪が要る。
 *
 * **点ごとに 2〜3 本足しても、平均次数は 4 ではなく 3.3 にしかならない**
 * （実測: 120 点 / 198 辺 / 次数の分布は `{2:16, 3:62, 4:34, 5:6, 6:2}`）。
 * 近い相手は互いに近いので、`dedupeEdges` が落とす重複が多い。**この分布は
 * `graph-field.ts` の `HUB_DEGREE` が実際に届くかを決める**ので、ここを触るなら
 * あちらの閾値も見直すこと（M11 のレビュー指摘 🔴 は、まさにその見落としだった）。
 */
const NEAREST_K = 2;

/** 何割の点に 1 本多く足すか。**全部同じ本数にすると規則正しさが戻ってくる** */
const NEAREST_EXTRA_RATE = 0.4;

/** 骨格の種。変えると別のグラフになる（作品としては固定） */
export const GRAPH_SEED = 0x51f3;

/** 2 点の距離 */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 中心ほど密な円盤に点を撒く。乱数を引数で受け取るので、この関数自体は純粋
 * （`createGrainSets` と同じ形）。
 */
export function scatterDisc(count: number, random: () => number): Point[] {
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    // 半径をそのまま一様に取ると中心に溜まる（外側ほど円周が長いため）。
    // 面積あたり一様にする指数が 0.5 で、そこから上げるぶんだけ中心へ寄る
    const radius = Math.pow(random(), RADIAL_BIAS);

    return {
      x: Math.cos(angle) * radius * DISC_ASPECT,
      y: Math.sin(angle) * radius,
    };
  });
}

/**
 * 最小全域木（Prim 法）。**連結成分が 1 つであることはここだけが保証する。**
 *
 * 距離のしきい値で結ぶやり方だと、孤立点や割れた成分が必ず出る（第 2 稿で
 * 実際にそうなった）。木を先に張っておけば、あとから足す辺が何本であっても
 * 「どこから辿っても全点に届く」は壊れない。
 *
 * 点は 120 程度なので素朴な O(n²) で足りる。**組み立て時の 1 回だけ**呼ぶので、
 * 優先度付きキューを持ち込む規模ではない。
 */
export function spanningTree(points: readonly Point[]): Edge[] {
  const n = points.length;
  if (n < 2) return [];

  // 木に入っていない各点について、木の中で一番近い相手とその距離を控える
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const bestFrom = new Array<number>(n).fill(-1);
  const edges: Edge[] = [];

  inTree[0] = true;
  for (let i = 1; i < n; i++) {
    best[i] = distance(points[0], points[i]);
    bestFrom[i] = 0;
  }

  // 木に n-1 本の辺を足せば全点が入る
  for (let added = 1; added < n; added++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (pick === -1 || best[i] < best[pick])) pick = i;
    }
    // 到達不能は起こり得ない（距離は常に有限）が、-1 のまま添字に使うと
    // 静かに undefined を掴むので番人を置く
    if (pick === -1) break;

    inTree[pick] = true;
    edges.push([bestFrom[pick], pick]);

    // 木が伸びたぶんだけ「一番近い相手」が更新されうる
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = distance(points[pick], points[i]);
      if (d < best[i]) {
        best[i] = d;
        bestFrom[i] = pick;
      }
    }
  }

  return edges;
}

/**
 * 各点から近い順に数本ずつ辺を足す。網としての密度はここが決める。
 *
 * 本数を点ごとに散らす（`NEAREST_EXTRA_RATE`）のは、全部同じにすると
 * どの点も同じ形に見えて、格子で作った時と同じ「規則正しさ」が戻ってくるため。
 */
export function nearestEdges(
  points: readonly Point[],
  k: number,
  random: () => number,
): Edge[] {
  const edges: Edge[] = [];

  for (let i = 0; i < points.length; i++) {
    const others = points
      .map((point, index) => ({ index, d: distance(points[i], point) }))
      .filter((candidate) => candidate.index !== i)
      .sort((a, b) => a.d - b.d);

    const take = k + (random() < NEAREST_EXTRA_RATE ? 1 : 0);
    for (let m = 0; m < take && m < others.length; m++) {
      edges.push([i, others[m].index]);
    }
  }

  return edges;
}

/**
 * 同じ対の重複と自己ループを落とし、`a < b` に揃える。
 *
 * **揃えるのは重複を落とすためだけではない。** 描く側が「辺 1 本につき線 1 本」で
 * 済むようにするため — `[3, 7]` と `[7, 3]` が両方残っていると、同じ線が 2 回
 * 引かれて**そこだけ濃くなる**（不透明度を重ねて描くので画に出る）。
 */
export function dedupeEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];

  for (const [x, y] of edges) {
    if (x === y) continue;
    const a = Math.min(x, y);
    const b = Math.max(x, y);
    const key = `${a},${b}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push([a, b]);
  }

  return out;
}

/** 各点に集まっている辺の本数を数える */
export function countDegrees(nodeCount: number, edges: readonly Edge[]): number[] {
  const degrees = new Array<number>(nodeCount).fill(0);

  for (const [a, b] of edges) {
    degrees[a]++;
    degrees[b]++;
  }

  return degrees;
}

/**
 * 骨格を組み立てる。**この順序に意味がある** — 全域木が連結を保証し、
 * 近傍の辺が網としての密度を足す。逆にすると、近傍だけで繋がっている所へ
 * 木が重複した辺を張ることになる（`dedupeEdges` が落とすので害は無いが、
 * 「連結は木が保証している」という読み筋が消える）。
 */
export function createGraphShape(random: () => number, count = NODE_COUNT): GraphShape {
  const nodes = scatterDisc(count, random);
  const edges = dedupeEdges([...spanningTree(nodes), ...nearestEdges(nodes, NEAREST_K, random)]);

  return { nodes, edges, degrees: countDegrees(nodes.length, edges) };
}
