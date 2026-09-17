import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Select, Space, Steps, Tag, Tooltip, Typography } from 'antd';
import { STAGE_GROUPS, useReviewEvents } from '../hooks/use-review-events';
import type { CompletedResult } from '../hooks/use-review-events';
import { cancelReview, startReview } from '../api';
import { CardHeading, PageHeader } from '../components/PageHeader';
import { useNotify } from '../hooks/use-notify';

type RunFormValues = {
  repoPath: string;
  mode?: 'fast' | 'full';
  blockOn?: 'BLOCKER' | 'WARNING' | 'NIT';
};
export type RunReviewViewProps = { onCompleted: (reviewId: string) => void };

export function RunReviewView(props: RunReviewViewProps): ReactElement {
  const [runningId, setRunningId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const { notifyError } = useNotify();
  const startMutation = useMutation({
    mutationFn: (values: RunFormValues) =>
      startReview(values.repoPath, values.mode, values.blockOn),
    onSuccess: setRunningId,
    onError: (e) => notifyError(e, { title: '发起审查失败' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelReview(runningId ?? ''),
    onError: (e) => notifyError(e, { title: '取消审查失败' }),
  });
  const handleFinish = (failed: boolean): void => {
    if (!failed) {
      props.onCompleted(runningId ?? '');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    }
  };
  const progress = useReviewEvents(runningId, handleFinish);
  const progressStatus = progress.cancelled
    ? '已取消'
    : progress.failed
      ? '失败'
      : progress.finished
        ? '已完成'
        : '进行中';

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review workspace"
        title="发起一次代码审查"
        description="选择仓库、审查模式和阻断阈值，实时跟踪分析进度并在完成后查看报告。"
      />
      <Card className="surface-card inline-form-card" title={<CardHeading title="审查配置" />}>
        <Form<RunFormValues>
          className="review-form"
          layout="vertical"
          onFinish={(values) => startMutation.mutate(values)}
        >
          <Form.Item
            label="仓库路径"
            name="repoPath"
            rules={[{ required: true, message: '请输入仓库路径' }]}
          >
            <Input placeholder="例如：D:/Code/your-project" />
          </Form.Item>
          <Form.Item label="审查模式" name="mode">
            <Select
              placeholder="使用系统默认"
              allowClear
              options={[
                { value: 'fast', label: 'Fast · 快速反馈' },
                { value: 'full', label: 'Full · 完整分析' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={
              <Tooltip title="达到该级别时，审查结果将标记为阻断；未选择时使用系统配置的默认阈值。">
                <span>阻断阈值</span>
              </Tooltip>
            }
            name="blockOn"
          >
            <Select
              placeholder="使用系统默认"
              allowClear
              options={[
                { value: 'BLOCKER', label: 'BLOCKER · 严重问题' },
                { value: 'WARNING', label: 'WARNING · 警告及以上' },
                { value: 'NIT', label: 'NIT · 全部问题' },
              ]}
            />
          </Form.Item>
          <Form.Item className="review-form-actions">
            <Button type="primary" htmlType="submit" loading={startMutation.isPending}>
              开始审查
            </Button>
          </Form.Item>
        </Form>
      </Card>
      {runningId !== undefined ? (
        <Card
          className="surface-card"
          title={<CardHeading title="实时进度" />}
          extra={
            <Tag
              color={
                progress.failed
                  ? 'error'
                  : progress.cancelled
                    ? 'default'
                    : progress.finished
                      ? 'success'
                      : 'processing'
              }
            >
              {progressStatus}
            </Tag>
          }
        >
          <div className="progress-panel">
            <div className="progress-id">
              <span className="progress-id-label">当前审查任务</span>
              <Typography.Text copyable className="progress-id-value">
                {runningId}
              </Typography.Text>
            </div>
            <Steps
              responsive
              items={STAGE_GROUPS.map((group, index) => ({
                title: group.label,
                status:
                  progress.finished && !progress.failed && !progress.cancelled
                    ? 'finish'
                    : (progress.failed || progress.cancelled) && index === progress.step
                      ? 'error'
                      : index < progress.step
                        ? 'finish'
                        : index === progress.step
                          ? 'process'
                          : 'wait',
              }))}
            />
            {!progress.finished ? (
              <Button
                danger
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                取消审查
              </Button>
            ) : null}
            {progress.failed || progress.cancelled ? (
              <Alert
                style={{ marginTop: 24 }}
                type={progress.cancelled ? 'warning' : 'error'}
                showIcon
                message={progress.cancelled ? '审查已取消' : '审查失败'}
                description={progress.message}
              />
            ) : null}
            {progress.result !== undefined ? (
              <CompletedResultAlert result={progress.result} />
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="surface-card empty-state-card">
          <Typography.Text className="empty-state-copy">
            填写上方配置并点击「开始审查」即可发起新一轮代码审查。
          </Typography.Text>
        </Card>
      )}
    </div>
  );
}

function CompletedResultAlert(props: { result: CompletedResult }): ReactElement {
  const result = props.result;
  return (
    <Alert
      style={{ marginTop: 24 }}
      type={result.blocking ? 'error' : 'success'}
      showIcon
      message={
        result.blocking
          ? `审查完成：达到阻断阈值（BLOCKER × ${result.blockerCount}）`
          : '审查完成：未达阻断阈值'
      }
      description={
        <Space>
          风险评分 <Tag color={result.blocking ? 'error' : 'success'}>{result.riskScore}/100</Tag>
        </Space>
      }
    />
  );
}
