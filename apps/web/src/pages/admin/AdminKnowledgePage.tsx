import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Empty, List, Skeleton, Space, Statistic, Tag, Typography } from 'antd';
import { DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchKnowledgeStatus, reindexKnowledge } from '../../api';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

export function AdminKnowledgePage(): ReactElement {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['admin-knowledge'],
    queryFn: fetchKnowledgeStatus,
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  });
  const reindexMutation = useMutation({
    mutationFn: reindexKnowledge,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-knowledge'] }),
  });

  if (statusQuery.isPending) return <Card className="surface-card"><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (statusQuery.isError) return <Alert type="error" showIcon message="知识库状态读取失败" description={describeError(statusQuery.error)} />;
  const status = statusQuery.data;
  const statusColor = status.status === 'ready' ? 'green' : status.status === 'error' ? 'red' : 'blue';
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Knowledge base"
        title="知识库管理"
        description="查看当前索引状态，并在文档或代码规范发生变化后重新构建 RAG 索引。"
        extra={<Button type="primary" icon={<ReloadOutlined />} loading={reindexMutation.isPending} disabled={status.status === 'disabled'} onClick={() => reindexMutation.mutate()}>重建索引</Button>}
      />
      {reindexMutation.isError && <Alert type="error" showIcon message="重建任务提交失败" description={describeError(reindexMutation.error)} closable />}
      <Card className="surface-card" title={<CardHeading title="索引概况" />}>
        <Space size="large" wrap>
          <Statistic title="状态" valueRender={() => <Tag color={statusColor}>{status.status}</Tag>} />
          <Statistic title="文本块" value={status.chunkCount} prefix={<DatabaseOutlined />} />
          <Statistic title="最后更新" value={status.lastIndexedAt ?? '尚未构建'} />
        </Space>
        <Descriptions className="knowledge-meta" column={1} bordered size="small">
          <Descriptions.Item label="索引目录">{status.indexDir}</Descriptions.Item>
          <Descriptions.Item label="索引路径">{status.paths.length === 0 ? '未配置' : status.paths.join('、')}</Descriptions.Item>
        </Descriptions>
        {status.error !== null && <Alert className="knowledge-error" type="error" showIcon message={status.error} />}
      </Card>
      <Card className="surface-card" title={<CardHeading title="配置的知识库路径" />}>
        {status.paths.length === 0 ? <Empty description="暂无知识库路径" /> : <List dataSource={status.paths} renderItem={(path) => <List.Item><Typography.Text code>{path}</Typography.Text></List.Item>} />}
      </Card>
    </div>
  );
}
