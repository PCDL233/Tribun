import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Select, Space, Steps, Typography } from 'antd';
import { STAGE_GROUPS, useReviewEvents } from '../hooks/use-review-events';
import type { CompletedResult } from '../hooks/use-review-events';
import { describeError } from '../parse-response';
import { startReview } from '../api';

type RunFormValues = {
  repoPath: string;
  mode: 'fast' | 'full';
};

export type RunReviewViewProps = {
  onCompleted: (reviewId: string) => void;
};

/** 发起审查 + SSE 实时进度（方案 3.10 页面 3） */
export function RunReviewView(props: RunReviewViewProps): ReactElement {
  const [runningId, setRunningId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: (values: RunFormValues) => startReview(values.repoPath, values.mode),
    onSuccess: (reviewId) => setRunningId(reviewId),
  });

  const handleFinish = (failed: boolean): void => {
    if (!failed) {
      props.onCompleted(runningId ?? '');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    }
  };
  const progress = useReviewEvents(runningId, handleFinish);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Form<RunFormValues>
        layout="inline"
        initialValues={{ mode: 'fast' }}
        onFinish={(values) => startMutation.mutate(values)}
      >
        <Form.Item
          name="repoPath"
          rules={[{ required: true, message: '请输入仓库路径' }]}
          style={{ minWidth: 360 }}
        >
          <Input placeholder="本地仓库路径（如 D:/Code/demo）" />
        </Form.Item>
        <Form.Item name="mode">
          <Select
            style={{ width: 120 }}
            options={[
              { value: 'fast', label: 'fast（快速）' },
              { value: 'full', label: 'full（完整）' },
            ]}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={startMutation.isPending}>
            发起审查
          </Button>
        </Form.Item>
      </Form>

      {startMutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="发起失败"
          description={describeError(startMutation.error)}
        />
      ) : null}

      {runningId !== undefined ? (
        <>
          <Typography.Text>审查 {runningId} 进行中…</Typography.Text>
          <Steps
            size="small"
            items={STAGE_GROUPS.map((group, index) => ({
              title: group.label,
              status:
                progress.finished && !progress.failed
                  ? 'finish'
                  : progress.failed && index === progress.step
                    ? 'error'
                    : index < progress.step
                      ? 'finish'
                      : index === progress.step
                        ? 'process'
                        : 'wait',
            }))}
          />
          {progress.failed ? (
            <Alert type="error" showIcon message="审查失败" description={progress.message} />
          ) : null}
          {progress.result !== undefined ? <CompletedResultAlert result={progress.result} /> : null}
        </>
      ) : null}
    </Space>
  );
}

function CompletedResultAlert(props: { result: CompletedResult }): ReactElement {
  const result = props.result;
  return (
    <Alert
      type={result.blocking ? 'error' : 'success'}
      showIcon
      message={
        result.blocking
          ? `审查完成：达到阻断阈值（BLOCKER × ${result.blockerCount}）`
          : '审查完成：未达阻断阈值'
      }
      description={`风险评分 ${result.riskScore}/100`}
    />
  );
}
