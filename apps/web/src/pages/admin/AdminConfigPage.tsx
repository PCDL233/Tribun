import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from 'antd';
import type { AdminConfig } from '@ai-review/shared/api';
import { AdminConfigSchema } from '@ai-review/shared/api';
import { fetchAdminConfig, updateAdminConfig } from '../../api';
import { CardHeading, PageHeader } from '../../components/PageHeader';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useNotify } from '../../hooks/use-notify';

const TOOL_OPTIONS = [
  { label: 'AST 解析', value: 'ast_parse' },
  { label: '复杂度检查', value: 'complexity_check' },
  { label: '密钥扫描', value: 'secret_scan' },
  { label: '依赖漏洞扫描', value: 'dependency_scan' },
];

export function AdminConfigPage(): ReactElement {
  const [form] = Form.useForm<AdminConfig>();
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const { notifyError } = useNotify();
  const configQuery = useQuery({ queryKey: ['admin-config'], queryFn: fetchAdminConfig });
  const saveMutation = useMutation({
    mutationFn: (config: AdminConfig) => updateAdminConfig(config),
    onSuccess: (config) => {
      form.setFieldsValue(config);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e) => notifyError(e, { title: '保存配置失败' }),
  });

  useEffect(() => {
    if (configQuery.data !== undefined) form.setFieldsValue(configQuery.data);
  }, [configQuery.data, form]);

  if (configQuery.isPending)
    return (
      <Card className="surface-card">
        <Skeleton active paragraph={{ rows: 12 }} />
      </Card>
    );
  if (configQuery.isError) {
    return (
      <ErrorAlert
        error={configQuery.error}
        title="配置加载失败"
        onRetry={() => void configQuery.refetch()}
      />
    );
  }

  const submit = (values: AdminConfig): void => {
    setSaved(false);
    const parsed = AdminConfigSchema.safeParse(values);
    if (!parsed.success) {
      const fields: Parameters<typeof form.setFields>[0] = parsed.error.issues.map((issue) => ({
        name: issue.path as never,
        errors: [issue.message],
      }));
      form.setFields(fields);
      return;
    }
    saveMutation.mutate(parsed.data);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Configuration"
        title="系统配置"
        description="管理审查模式、静态分析规则、RAG 知识库与报告输出策略。"
      />
      {saved && (
        <Alert
          type="success"
          showIcon
          message="配置已保存"
          closable
          onClose={() => setSaved(false)}
        />
      )}
      <Form form={form} layout="vertical" onFinish={submit}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card className="surface-card" title={<CardHeading title="审查与静态分析" />}>
              <Form.Item label="默认审查模式" name={['review', 'mode']}>
                <Select
                  options={[
                    { label: 'Fast（仅高风险文件）', value: 'fast' },
                    { label: 'Full（高风险 + 普通文件）', value: 'full' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="阻断阈值" name={['review', 'blockOn']}>
                <Select
                  options={[
                    { label: 'BLOCKER', value: 'BLOCKER' },
                    { label: 'WARNING', value: 'WARNING' },
                    { label: 'NIT', value: 'NIT' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="启用工具" name={['staticAnalysis', 'enabledTools']}>
                <Select mode="multiple" options={TOOL_OPTIONS} />
              </Form.Item>
              <Form.Item label="复杂度阈值" name={['staticAnalysis', 'complexityThreshold']}>
                <InputNumber min={1} max={100} className="full-width" />
              </Form.Item>
              <Form.Item label="包含 RAG 上下文" name={['rag', 'enabled']} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card className="surface-card" title={<CardHeading title="知识库" />}>
              <Form.Item label="知识库路径" name={['rag', 'knowledgeBasePaths']}>
                <Select mode="tags" placeholder="例如 docs/" />
              </Form.Item>
              <Form.Item label="索引目录" name={['rag', 'indexDir']}>
                <Input />
              </Form.Item>
              <Form.Item label="召回数量" name={['rag', 'topK']}>
                <InputNumber min={1} max={20} className="full-width" />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card className="surface-card" title={<CardHeading title="报告输出" />}>
              <Form.Item label="默认格式" name={['report', 'format']}>
                <Select
                  options={[
                    { label: 'Markdown', value: 'markdown' },
                    { label: 'HTML', value: 'html' },
                    { label: 'JSON', value: 'json' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="输出目录" name={['report', 'outputDir']}>
                <Input />
              </Form.Item>
              <Form.Item
                label="包含正向提示"
                name={['report', 'includePraise']}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Typography.Paragraph type="secondary" className="config-help">
                报告配置会影响 CLI 与 Web 两端的默认输出行为。
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            保存配置
          </Button>
          <Button htmlType="button" onClick={() => form.resetFields()}>
            撤销修改
          </Button>
        </Space>
      </Form>
    </div>
  );
}
