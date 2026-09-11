import { useEffect, useRef, useState } from 'react';
import { ReviewStageEventSchema } from '@ai-review/shared/api';

/** 流水线节点 → 进度条步骤分组（方案 3.10 页面 3 的五段进度条） */
const STAGE_GROUPS: ReadonlyArray<{ key: string; label: string; stages: readonly string[] }> = [
  { key: 'parse', label: '解析 diff', stages: ['parse'] },
  { key: 'plan', label: '风险规划', stages: ['riskPlan'] },
  {
    key: 'review',
    label: '并行审查',
    stages: ['correctness', 'security', 'performance', 'static'],
  },
  { key: 'validate', label: '交叉验证', stages: ['validate', 'heal'] },
  { key: 'report', label: '生成报告', stages: ['report'] },
];

function stageToStepIndex(stage: string): number {
  const index = STAGE_GROUPS.findIndex((group) => group.stages.includes(stage));
  return index === -1 ? 0 : index;
}

export type CompletedResult = {
  riskScore: number;
  blockerCount: number;
  blocking: boolean;
};

export type ReviewProgress = {
  /** 当前所处步骤索引（0-4） */
  step: number;
  currentStage: string | undefined;
  finished: boolean;
  failed: boolean;
  message: string | undefined;
  result: CompletedResult | undefined;
};

const INITIAL_PROGRESS: ReviewProgress = {
  step: 0,
  currentStage: undefined,
  finished: false,
  failed: false,
  message: undefined,
  result: undefined,
};

/**
 * 订阅审查进度 SSE（方案 3.9 节点级事件 → 实时进度条）。
 * SSE 订阅是浏览器长连接生命周期管理，属于 useEffect 的合法职责（非服务端状态拉取）。
 * @param reviewId 运行中的审查 ID；undefined 时不订阅
 * @param onFinish 终态回调（参数为是否失败），经 ref 持有以避免重订阅
 */
export function useReviewEvents(
  reviewId: string | undefined,
  onFinish: (failed: boolean) => void,
): ReviewProgress {
  const [progress, setProgress] = useState<ReviewProgress>(INITIAL_PROGRESS);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    if (reviewId === undefined) return;
    setProgress(INITIAL_PROGRESS);
    const source = new EventSource(`/api/reviews/${encodeURIComponent(reviewId)}/events`);

    const handleEvent = (event: Event): void => {
      if (!(event instanceof MessageEvent)) return;
      const parsed = ReviewStageEventSchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return;
      const payload = parsed.data;
      if (payload.type === 'stage') {
        setProgress((current) => ({
          ...current,
          currentStage: payload.stage,
          step: Math.max(current.step, stageToStepIndex(payload.stage)),
        }));
        return;
      }
      if (payload.type === 'completed') {
        setProgress((current) => ({
          ...current,
          finished: true,
          result: {
            riskScore: payload.riskScore,
            blockerCount: payload.blockerCount,
            blocking: payload.blocking,
          },
        }));
      } else {
        setProgress((current) => ({
          ...current,
          finished: true,
          failed: true,
          message: payload.message,
        }));
      }
      onFinishRef.current(payload.type === 'failed');
    };

    for (const type of ['stage', 'completed', 'failed']) {
      source.addEventListener(type, handleEvent);
    }
    return () => source.close();
  }, [reviewId]);

  return progress;
}

export { STAGE_GROUPS };
