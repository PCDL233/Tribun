import { useState } from 'react';
import type { ReactElement } from 'react';
import { Layout, Tabs, Typography } from 'antd';
import { ReportDetailView } from './views/ReportDetailView';
import { ReviewListView } from './views/ReviewListView';
import { RunReviewView } from './views/RunReviewView';

/** AI Code Review Dashboard（方案 3.10）：审查历史 / 报告详情 / 发起审查 */
export default function App(): ReactElement {
  const [selectedReviewId, setSelectedReviewId] = useState<string | undefined>(undefined);

  if (selectedReviewId !== undefined) {
    return (
      <Layout.Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <ReportDetailView
          reviewId={selectedReviewId}
          onBack={() => setSelectedReviewId(undefined)}
        />
      </Layout.Content>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          AI Code Review Dashboard
        </Typography.Title>
      </Layout.Header>
      <Layout.Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <Tabs
          defaultActiveKey="history"
          items={[
            {
              key: 'history',
              label: '审查历史',
              children: <ReviewListView onOpen={setSelectedReviewId} />,
            },
            {
              key: 'run',
              label: '发起审查',
              children: (
                <RunReviewView
                  onCompleted={(reviewId) => setSelectedReviewId(reviewId || undefined)}
                />
              ),
            },
          ]}
        />
      </Layout.Content>
    </Layout>
  );
}
