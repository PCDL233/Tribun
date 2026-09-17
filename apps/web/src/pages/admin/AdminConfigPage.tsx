import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from 'antd';
import type { AdminConfig, ServerRuntime } from '@ai-review/shared/api';
import { AdminConfigSchema } from '@ai-review/shared/api';
import { fetchAdminConfig, fetchServerRuntime, updateAdminConfig } from '../../api';
import { CardHeading, PageHeader } from '../../components/PageHeader';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useNotify } from '../../hooks/use-notify';

const TOOL_OPTIONS = [
  { label: 'AST 解析', value: 'ast_parse' },
  { label: '复杂度检查', value: 'complexity_check' },
  { label: '密钥扫描', value: 'secret_scan' },
  { label: '依赖漏洞扫描', value: 'dependency_scan' },
  { label: '自定义规则检查', value: 'custom_rule_check' },
];

const DIMENSION_OPTIONS = [
  { label: '正确性', value: 'correctness' },
  { label: '安全性', value: 'security' },
  { label: '性能', value: 'performance' },
  { label: '可维护性', value: 'maintainability' },
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

  const submit = (): void => {
    setSaved(false);
    // 全量提交：取表单 store 的全部值（含未渲染 Form.Item 的其他配置段），
    // 避免只提交本页注册字段时把 AI 模型等其余配置段重置为默认值
    const values = form.getFieldsValue(true) as AdminConfig;
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
          description="「服务端」与「审计日志」参数需重启服务后生效；其余参数（审查模式/维度/忽略模式/RAG/报告等）下一次审查即生效。"
          closable
          onClose={() => setSaved(false)}
        />
      )}
      <Form form={form} layout="vertical" onFinish={submit}>
        <div className="config-masonry">
          <Card className="surface-card" title={<CardHeading title="审查与静态分析" />}>
            <Form.Item label="默认审查模式" name={['review', 'mode']}>
              <Select
                options={[
                  { label: 'Fast（仅高风险文件）', value: 'fast' },
                  { label: 'Full（高风险 + 普通文件）', value: 'full' },
                ]}
              />
            </Form.Item>
            <Form.Item label="审查维度" name={['review', 'dimensions']}>
              <Select mode="multiple" options={DIMENSION_OPTIONS} />
            </Form.Item>
            <Form.Item label="忽略模式" name={['review', 'ignorePatterns']}>
              <Select
                mode="tags"
                placeholder="例如 pnpm-lock.yaml、dist/**"
                open={false}
                suffixIcon={null}
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

          <Card className="surface-card" title={<CardHeading title="审计日志" />}>
            <Form.Item label="启用日志" name={['logging', 'enabled']} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="输出到控制台" name={['logging', 'console']} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="写入日志文件" name={['logging', 'file']} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="日志目录" name={['logging', 'dir']}>
              <Input placeholder="logs" />
            </Form.Item>
            <Form.Item label="文件保留天数" name={['logging', 'maxDays']}>
              <InputNumber min={1} max={3650} className="full-width" />
            </Form.Item>
            <Typography.Paragraph type="secondary" className="config-help">
              登录日志与操作日志按日滚动归档（ai-review-login-YYYY-MM-DD.log），超保留天数自动清理；
              日志配置在服务启动时读取，保存后需重启服务生效。
            </Typography.Paragraph>
          </Card>

          <Card className="surface-card" title={<CardHeading title="服务端" />}>
            <Form.Item
              label="允许审查的仓库根目录"
              name={['server', 'allowedRoots']}
              extra="留空表示仅当前工作目录；多个路径逐个添加（等价 AI_REVIEW_ALLOWED_ROOTS）"
            >
              <Select mode="tags" placeholder="例如 D:/work/repo-a" />
            </Form.Item>
            <Form.Item label="并行审查上限" name={['server', 'maxConcurrent']}>
              <InputNumber min={1} max={64} className="full-width" />
            </Form.Item>
            <Form.Item
              label="会话 Cookie 强制 Secure"
              name={['server', 'cookieSecure']}
              valuePropName="checked"
              extra="生产环境（NODE_ENV=production）下自动开启"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="开放注册"
              name={['server', 'allowRegister']}
              valuePropName="checked"
              extra="缺省仅在无任何用户时允许注册（首个管理员引导后关闭）"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="信任反向代理"
              name={['server', 'trustProxy']}
              valuePropName="checked"
              extra="nginx 等反代部署时开启，限流/审计改用 X-Forwarded-For 识别真实 IP"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="Ollama 回退模型"
              name={['server', 'ollamaModel']}
              extra="云端 provider 不可用时的本地兜底模型"
            >
              <Input placeholder="qwen3-coder:30b" />
            </Form.Item>
            <Typography.Paragraph type="secondary" className="config-help">
              服务端参数在服务启动时读取，保存后需重启服务生效；已设置的环境变量
              （AI_REVIEW_*）仍优先于此处配置。
            </Typography.Paragraph>
          </Card>
        </div>
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
