import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import type { AdminConfig } from '@ai-review/shared/api';
import { AdminConfigSchema } from '@ai-review/shared/api';
import { fetchAdminConfig, updateAdminConfig } from '../../api';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

const PROVIDER_OPTIONS = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Ollama', value: 'ollama' },
  { label: 'Mock（离线）', value: 'mock' },
];

const DEFAULT_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

export function AdminAiConfigPage(): ReactElement {
  const [form] = Form.useForm<AdminConfig>();
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['admin-config'], queryFn: fetchAdminConfig });
  const saveMutation = useMutation({
    mutationFn: (config: AdminConfig) => updateAdminConfig(config),
    onSuccess: (config) => {
      form.setFieldsValue(config);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
  });

  useEffect(() => {
    if (configQuery.data !== undefined) form.setFieldsValue(configQuery.data);
  }, [configQuery.data, form]);

  const handleProviderChange = (provider: string): void => {
    const current = form.getFieldValue(['llm', 'baseUrl']) as string | undefined;
    if (current === undefined || current === '') {
      form.setFieldValue(['llm', 'baseUrl'], DEFAULT_ENDPOINTS[provider] ?? '');
    }
  };

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
        eyebrow="Admin / AI Model"
        title="AI 模型配置"
        description="配置审查使用的模型服务。API Key 提交后会被安全掩码，Base URL 支持自定义端点或留空使用默认值。"
      />
      {saveMutation.isError && (
        <Alert
          type="error"
          showIcon
          message="保存失败"
          description={describeError(saveMutation.error)}
          closable
        />
      )}
      {saved && (
        <Alert
          type="success"
          showIcon
          message="配置已保存"
          closable
          onClose={() => setSaved(false)}
        />
      )}
      <Card className="surface-card" title={<CardHeading title="模型服务" />}>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item
            label="Provider"
            name={['llm', 'provider']}
            rules={[{ required: true, message: '请选择模型提供商' }]}
          >
            <Select options={PROVIDER_OPTIONS} onChange={handleProviderChange} />
          </Form.Item>
          <Form.Item
            label="模型"
            name={['llm', 'model']}
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="例如 claude-sonnet-4.5 或 gpt-4o" />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name={['llm', 'baseUrl']}
            extra="留空将使用提供商默认端点；也可填写兼容 OpenAI 协议的自定义地址。"
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item
            label="API Key"
            name={['llm', 'apiKey']}
            extra="支持直接填写密钥或 ${ENV_NAME} 环境变量引用。提交后页面将显示为掩码。"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-... 或 ${AI_REVIEW_API_KEY}" />
          </Form.Item>
          <Form.Item
            label="单次最大 Token"
            name={['llm', 'maxTokensPerReview']}
            rules={[{ required: true, message: '请输入单次最大 Token' }]}
          >
            <InputNumber min={1000} max={200000} step={1000} className="full-width" />
          </Form.Item>
          <Form.Item
            label="温度"
            name={['llm', 'temperature']}
            rules={[{ required: true, message: '请输入温度' }]}
          >
            <InputNumber min={0} max={2} step={0.1} className="full-width" />
          </Form.Item>
          <Form.Item label="Mock fixtures 目录" name={['llm', 'mockFixturesDir']}>
            <Input placeholder=".ai-review-cache/llm-fixtures" />
          </Form.Item>
          <Form.Item label="启用 RAG 上下文" name={['rag', 'enabled']} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              保存配置
            </Button>
            <Button htmlType="button" onClick={() => form.resetFields()}>
              撤销修改
            </Button>
          </Space>
        </Form>
      </Card>
      <Typography.Paragraph type="secondary">
        修改模型配置后，新发起的审查会立即生效；运行中的审查仍使用旧配置。
      </Typography.Paragraph>
    </div>
  );
}
