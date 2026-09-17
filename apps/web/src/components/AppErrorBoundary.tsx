import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button, Result } from 'antd';
import { getErrorMessage } from '../parse-response';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 渲染期全局兜底：组件抛错时不再整树卸载（白屏），
 * 而是展示统一错误页并提供刷新入口。
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] uncaught render error:', error, info);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={getErrorMessage(this.state.error)}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
