import { useQueryClient } from '@tanstack/react-query';
import { useOptimistic, useState, useTransition } from 'react';
import type { ReactElement } from 'react';
import { Switch } from 'antd';
import type { IdentifiedFinding } from '@ai-review/shared/api';
import { markFalsePositive } from '../api';

type FalsePositiveSwitchProps = {
  finding: IdentifiedFinding;
  reviewId: string;
};

/**
 * 误报标记开关（方案 3.10 页面 2）：useOptimistic 乐观更新，
 * 回写失败时 invalidate 查询回滚到落库值（规范 §9.3）。
 */
export function FalsePositiveSwitch(props: FalsePositiveSwitchProps): ReactElement {
  const [optimisticValue, setOptimisticValue] = useOptimistic(props.finding.isFalsePositive);
  const [, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const queryClient = useQueryClient();

  const handleChange = (next: boolean): void => {
    startTransition(() => {
      setOptimisticValue(next);
      markFalsePositive(props.finding.id, next)
        .then(() => setError(false))
        .catch(() => setError(true))
        .finally(() => {
          // 无论成败都回读落库值：成功对齐 id，失败回滚乐观值
          void queryClient.invalidateQueries({ queryKey: ['review', props.reviewId] });
          void queryClient.invalidateQueries({ queryKey: ['reviews'] });
        });
    });
  };

  return (
    <>
      <Switch checked={optimisticValue} onChange={handleChange} size="small" />
      {error ? <span style={{ color: '#cf1322', marginLeft: 4 }}>回写失败</span> : null}
    </>
  );
}
