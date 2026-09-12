import { describe, expect, it } from 'vitest';
import { rrfFuse } from '../src/fusion.js';
import type { RankedHit } from '../src/fusion.js';

function hit(id: string, path = id): RankedHit {
  return { id, path, kind: 'fn', text: `text of ${id}` };
}

describe('rrfFuse (方案 3.5 倒数排名融合)', () => {
  it('boosts items recalled by both channels', () => {
    const vectorHits = [hit('a'), hit('b'), hit('c')];
    const bm25Hits = [hit('a'), hit('x')];
    const fused = rrfFuse(vectorHits, bm25Hits, 5);
    // a 双路命中且两路均靠前，应胜过仅单路命中的 b/x
    expect(fused[0]?.id).toBe('a');
    expect(fused.slice(1).map((result) => result.id).sort()).toEqual(['b', 'c', 'x']);
  });

  it('respects topK and applies the path filter to both channels', () => {
    const vectorHits = [hit('a', 'src/a.ts'), hit('b', 'src/b.ts')];
    const bm25Hits = [hit('b', 'src/b.ts'), hit('c', 'src/c.ts')];
    const fused = rrfFuse(vectorHits, bm25Hits, 1, { path: 'src/b.ts' });
    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({ id: 'b', path: 'src/b.ts', score: expect.any(Number) });
  });

  it('keeps single-channel items with a lower RRF score', () => {
    const fused = rrfFuse([hit('only-vector')], [], 5);
    // 1/(60+1) 的 RRF 得分仍应输出
    expect(fused).toHaveLength(1);
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 6);
  });
});
