import type { RagHit } from '@ai-review/shared';

/** 参与融合的单路召回结果（rank 为 1-based 排名） */
export type RankedHit = {
  id: string;
  path: string;
  kind: string;
  text: string;
};

/** 倒数排名融合常数：业界默认 60，对头部命中加权、对长尾平滑（方案 3.5 RRF） */
const RRF_K = 60;

/**
 * 倒数排名融合（RRF，方案 3.5）：合并向量召回与 BM25 召回。
 * 只用排名不用原始分数，规避余弦距离与 BM25 分数量纲不可比的问题——
 * 这是"先确定性可解释、后语义相似"融合顺序的确定性约定。
 *
 * @param vectorHits 向量召回（按相似度降序）
 * @param bm25Hits BM25 召回（按分数降序）
 * @param topK 最终返回条数
 * @param filter 可选路径过滤（与 RagQuery.filter 语义一致）
 * @returns 融合排序后的命中列表
 */
export function rrfFuse(
  vectorHits: readonly RankedHit[],
  bm25Hits: readonly RankedHit[],
  topK: number,
  filter?: { path?: string },
): RagHit[] {
  const scores = new Map<string, { hit: RankedHit; score: number }>();
  const accumulate = (hits: readonly RankedHit[]): void => {
    for (const [index, hit] of hits.entries()) {
      if (filter?.path !== undefined && hit.path !== filter.path) continue;
      const entry = scores.get(hit.id);
      const contribution = 1 / (RRF_K + index + 1);
      if (entry === undefined) scores.set(hit.id, { hit, score: contribution });
      else entry.score += contribution;
    }
  };
  accumulate(vectorHits);
  accumulate(bm25Hits);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ hit, score }) => ({ ...hit, score }));
}
