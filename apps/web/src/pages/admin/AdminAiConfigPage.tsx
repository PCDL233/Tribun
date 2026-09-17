import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AutoComplete,
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
import { MODEL_PROVIDER_LIST, MODEL_PROVIDERS } from '@ai-review/shared/api';
import { fetchAdminConfig, updateAdminConfig } from '../../api';
import { CardHeading, PageHeader } from '../../components/PageHeader';
import { LoadErrorState } from '../../components/ErrorAlert';
import { useNotify } from '../../hooks/use-notify';

/** Provider 下拉选项直接取自 shared 目录，与配置 schema 同源，避免双份维护。 */
const PROVIDER_OPTIONS = MODEL_PROVIDER_LIST.map((info) => ({
  label: info.label,
  value: info.id,
}));

export function AdminAiConfigPage(): ReactElement {
  const [form] = Form.useForm<AdminConfig>();
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const { notifyError } = useNotify();
  const configQuery = useQuery({ queryKey: ['admin-config'], queryFn: fetchAdminConfig });
  // 当前 Provider 决定“推荐模型”预设列表；模型字段仍可自由输入。
  const provider =
    Form.useWatch<AdminConfig['llm']['provider']>(['llm', 'provider'], form) ?? 'anthropic';
  const recommendedModels = MODEL_PROVIDERS[provider]?.recommendedModels ?? [];
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

  if (configQuery.isError) {
    return (
      <div className="page-stack">
        <LoadErrorState
          error={configQuery.error}
          title="配置加载失败"
          onRetry={() => void configQuery.refetch()}
        />
      </div>
    );
  }

  const handleProviderChange = (provider: string): void => {
    const current = form.getFieldValue(['llm', 'baseUrl']) as string | undefined;
    if (current !== undefined && current !== '') return;
    const info = MODEL_PROVIDER_LIST.find((item) => item.id === provider);
    if (info !== undefined) {
      form.setFieldValue(['llm', 'baseUrl'], info.defaultEndpoint);
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
            extra="已支持国内主流模型服务：DeepSeek、智谱 GLM、Moonshot Kimi、通义千问、豆包、MiniMax。"
            rules={[{ required: true, message: '请选择模型提供商' }]}
          >
            <Select options={PROVIDER_OPTIONS} onChange={handleProviderChange} />
          </Form.Item>
          <Form.Item
            label="模型"
            name={['llm', 'model']}
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <AutoComplete
              options={recommendedModels.map((model) => ({ value: model }))}
              placeholder="选择推荐模型或直接输入，例如 deepseek-v4-pro"
            />
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
