import { useEffect, useRef, useState } from 'react';
import { ReviewStageEventSchema } from '@ai-review/shared/api';

/** 流水线节点 → 进度条步骤分组。 */
export const STAGE_GROUPS: ReadonlyArray<{ key: string; label: string; stages: readonly string[] }> = [
  { key: 'parse', label: '解析 diff', stages: ['parse'] },
  { key: 'plan', label: '风险规划', stages: ['riskPlan'] },
  { key: 'review', label: '并行审查', stages: ['correctness', 'security', 'performance', 'static'] },
  { key: 'validate', label: '交叉验证', stages: ['validate', 'heal'] },
  { key: 'report', label: '生成报告', stages: ['report'] },
];

function stageToStepIndex(stage: string): number {
  const index = STAGE_GROUPS.findIndex((group) => group.stages.includes(stage));
  return index === -1 ? 0 : index;
}

export type CompletedResult = { riskScore: number; blockerCount: number; blocking: boolean };
export type ReviewProgress = {
  step: number;
  currentStage: string | undefined;
  finished: boolean;
  failed: boolean;
  cancelled: boolean;
  message: string | undefined;
  result: CompletedResult | undefined;
};

const INITIAL_PROGRESS: ReviewProgress = {
  step: 0,
  currentStage: undefined,
  finished: false,
  failed: false,
  cancelled: false,
  message: undefined,
  result: undefined,
};

/** 订阅审查进度 SSE，并在组件卸载时关闭长连接。 */
export function useReviewEvents(reviewId: string | undefined, onFinish: (failed: boolean) => void): ReviewProgress {
  const [progress, setProgress] = useState<ReviewProgress>(INITIAL_PROGRESS);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    if (reviewId === undefined) return;
    setProgress(INITIAL_PROGRESS);
    const source = new EventSource(`/api/reviews/${encodeURIComponent(reviewId)}/events`);

    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent)) return;
      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(String(event.data)) as unknown;
      } catch {
        // SSE 可能被代理或旧服务写入非 JSON 数据；忽略坏帧，保持连接继续接收后续事件。
        return;
      }
      const parsed = ReviewStageEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const payload = parsed.data;
      if (payload.type === 'stage') {
        setProgress((current) => ({ ...current, currentStage: payload.stage, step: Math.max(current.step, stageToStepIndex(payload.stage)) }));
        return;
      }
      if (payload.type === 'completed') {
        setProgress((current) => ({ ...current, finished: true, result: { riskScore: payload.riskScore, blockerCount: payload.blockerCount, blocking: payload.blocking } }));
      } else {
        setProgress((current) => ({ ...current, finished: true, failed: payload.type === 'failed', cancelled: payload.type === 'cancelled', message: payload.message }));
      }
      onFinishRef.current(payload.type !== 'completed');
    };

    for (const type of ['stage', 'completed', 'failed', 'cancelled']) source.addEventListener(type, handleEvent);
    return () => source.close();
  }, [reviewId]);

  return progress;
}
