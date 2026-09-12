import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Select, Steps, Tag, Typography } from 'antd';
import { STAGE_GROUPS, useReviewEvents } from '../hooks/use-review-events';
import type { CompletedResult } from '../hooks/use-review-events';
import { describeError } from '../parse-response';
import { startReview } from '../api';
import { CardHeading, PageHeader } from '../components/PageHeader';

type RunFormValues = { repoPath: string; mode: 'fast' | 'full' };
export type RunReviewViewProps = { onCompleted: (reviewId: string) => void };

export function RunReviewView(props: RunReviewViewProps): ReactElement {
  const [runningId, setRunningId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const startMutation = useMutation({
    mutationFn: (values: RunFormValues) => startReview(values.repoPath, values.mode),
    onSuccess: setRunningId,
  });
  const handleFinish = (failed: boolean): void => {
    if (!failed) {
      props.onCompleted(runningId ?? '');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    }
  };
  const progress = useReviewEvents(runningId, handleFinish);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review workspace"
        title="发起一次代码审查"
        description="输入本地仓库路径，选择审查模式，实时跟踪 AI 对代码风险的分析过程。"
      />
      <Card className="surface-card inline-form-card" title={<CardHeading title="审查配置" />}>
        <Form<RunFormValues>
          className="review-form"
          layout="vertical"
          initialValues={{ mode: 'fast' }}
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
              options={[
                { value: 'fast', label: 'Fast · 快速' },
                { value: 'full', label: 'Full · 完整' },
              ]}
            />
          </Form.Item>
          <Form.Item label=" " colon={false}>
            <Button type="primary" htmlType="submit" loading={startMutation.isPending}>
              开始审查 →
            </Button>
          </Form.Item>
        </Form>
      </Card>
      {startMutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="发起失败"
          description={describeError(startMutation.error)}
        />
      ) : null}
      {runningId !== undefined ? (
        <Card className="surface-card" title={<CardHeading title="实时进度" />}>
          <div className="progress-panel">
            <div className="progress-id">
              <span className="progress-id-label">当前审查任务</span>
              <span className="progress-id-value">{runningId}</span>
            </div>
            <Steps
              responsive
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
              <Alert
                style={{ marginTop: 24 }}
                type="error"
                showIcon
                message="审查失败"
                description={progress.message}
              />
            ) : null}
            {progress.result !== undefined ? (
              <CompletedResultAlert result={progress.result} />
            ) : null}
          </div>
        </Card>
      ) : (
        <Card
          className="surface-card"
          style={{ background: 'linear-gradient(135deg,#f9faff,#fff)' }}
        >
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            一次审查，三步完成
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ maxWidth: 640, marginBottom: 0 }}>
            选择 Fast 模式快速获得反馈，或使用 Full
            模式进行更完整的风险分析。审查完成后，你可以在报告中逐条标记误报并查看建议。
          </Typography.Paragraph>
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
        <span>
          风险评分 <Tag color={result.blocking ? 'error' : 'success'}>{result.riskScore}/100</Tag>
        </span>
      }
    />
  );
}
