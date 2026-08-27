import { describe, expect, it } from 'vitest';
import { seededRandom } from '../lib/random';
import {
  countDegrees,
  createGraphShape,
  dedupeEdges,
  DISC_ASPECT,
  distance,
  GRAPH_SEED,
  nearestEdges,
  scatterDisc,
  spanningTree,
  type Edge,
  type Point,
} from './graph-shape';

/**
 * 点の番号を辿って、繋がっている塊がいくつあるかを数える。
 *
 * **この作品の要件そのものを測る道具。** 「中央に据えた 1 つのグラフ」は
 * 見た目の話に見えて、実際には「連結成分が 1 つ」という骨格の性質。
 * 目で見て確かめるのは難しい（薄い線が 1 本切れていても気付けない）ので、
 * 数える側を持つ。
 */
function countComponents(nodeCount: number, edges: readonly Edge[]): number {
  const neighbours = Array.from({ length: nodeCount }, (): number[] => []);
  for (const [a, b] of edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }

  const seen = new Array<boolean>(nodeCount).fill(false);
  let components = 0;

  for (let start = 0; start < nodeCount; start++) {
    if (seen[start]) continue;

    components += 1;
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const next of neighbours[current]) {
        if (seen[next]) continue;
        seen[next] = true;
        stack.push(next);
      }
    }
  }

  return components;
}

/** 引き伸ばす前の半径。scatterDisc は x を DISC_ASPECT 倍してから返す */
function unstretchedRadius(point: Point): number {
  return Math.hypot(point.x / DISC_ASPECT, point.y);
}

describe('scatterDisc', () => {
  it('種が同じなら毎回同じ配置になる', () => {
    // リロードのたびにグラフが組み変わらない＝配置も作品の一部として固定される
    expect(scatterDisc(30, seededRandom(1))).toEqual(scatterDisc(30, seededRandom(1)));
  });

  it('点は塊の中（半径 1 前後）に収まる', () => {
    // 位置は画面の大きさに依らない「塊の中の座標」。ここが 1 を大きく超えると、
    // 描く側が短辺から決めた半径に収まらず、塊が画面の外へはみ出す
    for (const point of scatterDisc(400, seededRandom(7))) {
      expect(unstretchedRadius(point)).toBeLessThanOrEqual(1);
    }
  });

  it('中心ほど密（面積あたり一様よりも寄っている）', () => {
    // 中心が密なほど「1 つの塊」として読める。一様に近いと円い面に見える。
    // 面積あたり一様なら半径 0.5 の内側に入るのは 25%。それを明確に超えることを見る
    const points = scatterDisc(600, seededRandom(11));
    const inner = points.filter((point) => unstretchedRadius(point) < 0.5).length;

    expect(inner / points.length).toBeGreaterThan(0.3);
  });

  it('横に広がる（16:9 の画面で左右が余らない）', () => {
    // 縦を伸ばす形に変わると塊が上下で切れる（大きさを決めるのは短い辺なので、
    // 縦にはもともと余裕が無い）。伸ばす向きを検査で留める
    const points = scatterDisc(600, seededRandom(13));
    const widest = Math.max(...points.map((point) => Math.abs(point.x)));
    const tallest = Math.max(...points.map((point) => Math.abs(point.y)));

    expect(widest).toBeGreaterThan(tallest);
  });
});

describe('spanningTree', () => {
  it('n-1 本で全点を繋ぐ', () => {
    const points = scatterDisc(40, seededRandom(3));
    const edges = spanningTree(points);

    expect(edges).toHaveLength(points.length - 1);
    expect(countComponents(points.length, edges)).toBe(1);
  });

  it('一番近い相手どうしを結ぶ', () => {
    // 一直線に並んだ 4 点。遠い 1 点も、飛ばされずに一番近い隣から繋がる
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 10, y: 0 },
    ];

    expect(dedupeEdges(spanningTree(points))).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('点が 1 つ以下なら辺は無い', () => {
    // 空の入力で添字の外を掴まないこと（骨格の点数は定数なので通らない経路だが、
    // 関数として単体で正しくないと、点数を減らした時に静かに壊れる）
    expect(spanningTree([])).toEqual([]);
    expect(spanningTree([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe('nearestEdges', () => {
  it('近い順に足す（遠い相手を先に結ばない）', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 5, y: 0 },
    ];
    // 乱数が常に 1 を返す ＝ 追加の 1 本は足さない（NEAREST_EXTRA_RATE を超える）
    const edges = nearestEdges(points, 1, () => 1);

    expect(dedupeEdges(edges)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('点ごとに本数が散る（全部同じにすると規則正しさが戻る）', () => {
    const points = scatterDisc(60, seededRandom(5));
    const degrees = countDegrees(points.length, dedupeEdges(nearestEdges(points, 2, seededRandom(9))));

    expect(new Set(degrees).size).toBeGreaterThan(1);
  });
});

describe('dedupeEdges', () => {
  it('向きの違う同じ対を 1 本にまとめる', () => {
    // **同じ線を 2 回引くとそこだけ濃くなる**（不透明度を重ねて描くため）。
    // 重複を落とすのはデータの綺麗さのためではなく、画に出る差のため
    expect(dedupeEdges([[3, 7], [7, 3]])).toEqual([[3, 7]]);
  });

  it('自分自身への辺を落とす', () => {
    expect(dedupeEdges([[2, 2]])).toEqual([]);
  });

  it('a < b に揃える', () => {
    expect(dedupeEdges([[9, 1]])).toEqual([[1, 9]]);
  });
});

describe('countDegrees', () => {
  it('辺の両端を 1 本ずつ数える', () => {
    expect(countDegrees(3, [[0, 1], [1, 2]])).toEqual([1, 2, 1]);
  });

  it('辺の無い点は 0（点の数だけ必ず並ぶ）', () => {
    // 長さが点の数と揃っていないと、描く側が undefined を次数として扱う
    expect(countDegrees(4, [[0, 1]])).toEqual([1, 1, 0, 0]);
  });
});

describe('createGraphShape', () => {
  it('連結成分は 1 つ（作品の要件そのもの）', () => {
    const shape = createGraphShape(seededRandom(GRAPH_SEED));

    expect(countComponents(shape.nodes.length, shape.edges)).toBe(1);
  });

  it('種を変えても連結成分は 1 つのまま', () => {
    // 全域木が保証しているので、配置がどう変わっても割れない。
    // 距離のしきい値で結んでいた頃はここが破れた（第 2 稿）
    for (const seed of [1, 2, 3, 99, 12345]) {
      const shape = createGraphShape(seededRandom(seed));

      expect(countComponents(shape.nodes.length, shape.edges)).toBe(1);
    }
  });

  it('種が同じなら毎回同じ骨格になる', () => {
    expect(createGraphShape(seededRandom(GRAPH_SEED))).toEqual(
      createGraphShape(seededRandom(GRAPH_SEED)),
    );
  });

  it('木のままではない（輪があるから網に見える）', () => {
    // 全域木だけだと辺は n-1 本で閉路を持たず、見た目が「枝」になる。
    // 近傍の辺を足しているかどうかは、辺の本数でしか見分けられない
    const shape = createGraphShape(seededRandom(GRAPH_SEED));

    expect(shape.edges.length).toBeGreaterThan(shape.nodes.length - 1);
  });

  it('網が潰れるほど密ではない（平均次数は 6 未満）', () => {
    // 上限を見ないと、k をいくつに増やしても他の検査は全部通る。
    // 密になるほど辺が重なって、網ではなくただの面に見える
    const shape = createGraphShape(seededRandom(GRAPH_SEED));
    const average = (shape.edges.length * 2) / shape.nodes.length;

    expect(average).toBeGreaterThan(3);
    expect(average).toBeLessThan(6);
  });

  it('次数は点の数だけ並び、合計は辺の数の 2 倍', () => {
    const shape = createGraphShape(seededRandom(GRAPH_SEED));

    expect(shape.degrees).toHaveLength(shape.nodes.length);
    expect(shape.degrees.reduce((sum, degree) => sum + degree, 0)).toBe(shape.edges.length * 2);
  });

  it('辺は必ず実在する点を指す', () => {
    // 添字が範囲の外を指しても、描く側は undefined の座標で線を引くだけで
    // 例外を出さない（canvas は NaN の座標を黙って捨てる）＝ 線が消えるだけになる
    const shape = createGraphShape(seededRandom(GRAPH_SEED));

    for (const [a, b] of shape.edges) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(shape.nodes.length);
    }
  });

  it('点数を指定できる（骨格の性質は保たれる）', () => {
    const shape = createGraphShape(seededRandom(GRAPH_SEED), 20);

    expect(shape.nodes).toHaveLength(20);
    expect(countComponents(20, shape.edges)).toBe(1);
  });
});

describe('distance', () => {
  it('2 点のユークリッド距離', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
