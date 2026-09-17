import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import type {
  LoginLog,
  LoginLogAction,
  LoginLogQuery,
  OperationLog,
  OperationLogAction,
  OperationLogQuery,
} from '@ai-review/shared/api';
import { fetchLoginLogs, fetchOperationLogs } from '../../api/admin';
import { formatDateTime } from '../../format';
import { CardHeading } from '../../components/PageHeader';

/** 登录事件动作 → 中文标签（与后端 LOGIN_LOG_ACTIONS 对齐） */
const LOGIN_ACTION_LABELS: Record<LoginLogAction, string> = {
  login: '登录',
  logout: '登出',
  register: '注册',
  change_password: '修改密码',
};

/** 操作动作 → 中文标签（与后端 OPERATION_LOG_ACTIONS 对齐） */
const OPERATION_ACTION_LABELS: Record<OperationLogAction, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  login: '登录',
  logout: '登出',
  register: '注册',
  change_password: '修改密码',
  reset_password: '重置密码',
  assign_roles: '分配角色',
  start_review: '发起审查',
  rerun_review: '重跑审查',
  cancel_review: '取消审查',
  delete_review: '删除审查',
  mark_false_positive: '误报标记',
  save_config: '保存配置',
  save_rules: '保存规则',
  test_rules: '试跑规则',
  reindex_knowledge: '重建索引',
};

type LogKind = 'login' | 'operation';

type Filters = {
  from?: string;
  to?: string;
  status?: 'success' | 'failed';
  action?: string;
  q?: string;
};

/** 待应用筛选补丁：允许显式 undefined 以清空某筛选条件 */
type FilterPatch = {
  from?: string | undefined;
  to?: string | undefined;
  status?: 'success' | 'failed' | undefined;
  action?: string | undefined;
  q?: string | undefined;
};

function statusTag(status: 'success' | 'failed'): ReactElement {
  return (
    <Tag color={status === 'success' ? 'green' : 'red'}>
      {status === 'success' ? '成功' : '失败'}
    </Tag>
  );
}

/** 单元格：过长内容省略并悬浮展示全文 */
function cellWithTooltip(text: string): ReactElement {
  if (text === '') {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  return (
    <Tooltip title={text}>
      <Typography.Text style={{ maxWidth: 320 }} ellipsis>
        {text}
      </Typography.Text>
    </Tooltip>
  );
}

/**
 * 审计日志表格页（登录日志 / 操作日志共用组件）。
 * 支持按日期范围、状态、动作与关键词筛选，服务端分页。
 */
export function LogListPage({ kind }: { kind: LogKind }): ReactElement {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<Filters>({});
  const [pending, setPending] = useState<Filters>({});
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const queryKey = kind === 'login' ? 'login-logs' : 'operation-logs';

  const query = useQuery({
    queryKey: ['admin', queryKey, page, pageSize, filters],
    queryFn: (): Promise<{ logs: LoginLog[] | OperationLog[]; total: number; page: number; pageSize: number }> => {
      if (kind === 'login') {
        const q: LoginLogQuery = {
          page,
          pageSize,
          ...(filters.from === undefined ? {} : { from: filters.from }),
          ...(filters.to === undefined ? {} : { to: filters.to }),
          ...(filters.status === undefined ? {} : { status: filters.status }),
          ...(filters.action === undefined ? {} : { action: filters.action as LoginLogAction }),
          ...(filters.q === undefined ? {} : { q: filters.q }),
        };
        return fetchLoginLogs(q);
      }
      const q: OperationLogQuery = {
        page,
        pageSize,
        ...(filters.from === undefined ? {} : { from: filters.from }),
        ...(filters.to === undefined ? {} : { to: filters.to }),
        ...(filters.status === undefined ? {} : { status: filters.status }),
        ...(filters.action === undefined
          ? {}
          : { action: filters.action as OperationLogAction }),
        ...(filters.q === undefined ? {} : { q: filters.q }),
      };
      return fetchOperationLogs(q);
    },
    placeholderData: (previous) => previous,
  });

  const data = query.data;

  const applyFilters = (): void => {
    setPage(1);
    setFilters(pending);
  };

  /** 合并待应用筛选（undefined 字段表示清空该条件，避免残留过期值） */
  const updatePending = (patch: FilterPatch): void => {
    setPending((prev) => {
      const next: Filters = { ...prev };
      if (patch.from !== undefined) next.from = patch.from;
      if (patch.to !== undefined) next.to = patch.to;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.action !== undefined) next.action = patch.action;
      if (patch.q !== undefined) next.q = patch.q;
      return next;
    });
  };

  const resetFilters = (): void => {
    setRange(null);
    setPending({});
    setFilters({});
    setPage(1);
  };

  const columns = useMemo<ColumnsType<LoginLog | OperationLog>>(() => {
    if (kind === 'login') {
      return [
        { title: '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
        { title: '用户名', dataIndex: 'username', width: 150 },
        {
          title: '动作',
          dataIndex: 'action',
          width: 110,
          render: (a: LoginLogAction) => LOGIN_ACTION_LABELS[a],
        },
        {
          title: '结果',
          dataIndex: 'status',
          width: 90,
          render: (s: 'success' | 'failed') => statusTag(s),
        },
        {
          title: '原因',
          dataIndex: 'reason',
          width: 170,
          render: (r: string | null) => cellWithTooltip(r ?? ''),
        },
        { title: '来源 IP', dataIndex: 'ip', width: 140 },
        {
          title: 'User-Agent',
          dataIndex: 'userAgent',
          ellipsis: true,
          render: (ua: string) => cellWithTooltip(ua),
        },
      ];
    }
    return [
      { title: '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
      { title: '操作者', dataIndex: 'username', width: 140 },
      {
        title: '动作',
        dataIndex: 'action',
        width: 120,
        render: (a: OperationLogAction) => OPERATION_ACTION_LABELS[a],
      },
      {
        title: '资源',
        key: 'resource',
        width: 150,
        render: (_: unknown, record) => {
          const log = record as OperationLog;
          return (
            <Space size={4}>
              <Tag>{log.resource}</Tag>
              {log.resourceId === '' ? null : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {log.resourceId}
                </Typography.Text>
              )}
            </Space>
          );
        },
      },
      {
        title: '结果',
        dataIndex: 'status',
        width: 90,
        render: (s: 'success' | 'failed') => statusTag(s),
      },
      {
        title: '详情',
        dataIndex: 'detail',
        ellipsis: true,
        render: (d: string) => cellWithTooltip(d),
      },
      { title: '来源 IP', dataIndex: 'ip', width: 140 },
    ];
  }, [kind]);

  const actionOptions =
    kind === 'login'
      ? (Object.entries(LOGIN_ACTION_LABELS) as Array<[LoginLogAction, string]>).map(
          ([value, label]) => ({ value, label }),
        )
      : (Object.entries(OPERATION_ACTION_LABELS) as Array<[OperationLogAction, string]>).map(
          ([value, label]) => ({ value, label }),
        );

  return (
    <Card className="surface-card data-table-card">
      <CardHeading title={kind === 'login' ? '登录日志' : '操作日志'} />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        审计记录仅管理员可见；日志同时输出到控制台，并按日归档到日志目录（超保留天数自动清理）。
      </Typography.Paragraph>
      <div className="table-toolbar" style={{ marginTop: 16 }}>
        <Space wrap>
          <DatePicker.RangePicker
            value={range}
            onChange={(dates) => {
              setRange(dates as [Dayjs, Dayjs] | null);
              updatePending({
                from: dates?.[0]?.format('YYYY-MM-DD'),
                to: dates?.[1]?.format('YYYY-MM-DD'),
              });
            }}
            placeholder={['开始日期', '结束日期']}
          />
          <Select
            allowClear
            placeholder="结果"
            style={{ width: 110 }}
            value={pending.status}
            onChange={(status?: 'success' | 'failed') => updatePending({ status })}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <Select
            allowClear
            showSearch
            placeholder="动作"
            style={{ width: 140 }}
            value={pending.action}
            onChange={(action?: string) => updatePending({ action })}
            options={actionOptions}
          />
          <Input.Search
            allowClear
            placeholder={kind === 'login' ? '按用户名搜索' : '按用户名/资源搜索'}
            style={{ width: 200 }}
            onSearch={(value) => {
              const keyword = value.trim();
              updatePending({ q: keyword === '' ? undefined : keyword });
            }}
          />
          <Button type="primary" onClick={applyFilters}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </div>
      <Table<LoginLog | OperationLog>
        rowKey="id"
        size="middle"
        loading={query.isPending}
        columns={columns}
        dataSource={data?.logs ?? []}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
    </Card>
  );
}

/** 登录日志页（管理后台） */
export function AdminLoginLogsPage(): ReactElement {
  return <LogListPage kind="login" />;
}

/** 操作日志页（管理后台） */
export function AdminOperationLogsPage(): ReactElement {
  return <LogListPage kind="operation" />;
}
