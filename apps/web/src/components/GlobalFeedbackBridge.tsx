import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { App as AntdApp } from 'antd';
import { ApiError } from '../parse-response';

/**
 * 全局兜底监听（window error / unhandledrejection）。
 * 必须渲染在 <AntdApp> 内部：App.useApp() 只有在 <App> 子树中才能拿到真实
 * message 实例（antd v6 的 AppContext 默认值是空对象，越界调用会在
 * message.error 处抛 TypeError，并让兜底自身成为新的 rejection 形成循环）。
 * 所有 toast 调用均带防御：兜底处理器在任何情况下都不允许抛错。
 */
export function GlobalFeedbackBridge(): ReactElement {
  const { message } = AntdApp.useApp();

  useEffect(() => {
    /** 安全 toast：message 实例不可用或 Promise 拒绝时静默降级，绝不向上抛 */
    const safeToast = (content: string): void => {
      try {
        Promise.resolve(message.error(content)).catch(() => undefined);
      } catch {
        // message 实例缺失：仅保留控制台日志
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      console.error('[unhandledrejection]', event.reason);
      const reason: unknown = event.reason;
      // ApiError 已由页面级错误 UI（ErrorAlert/notifyError）呈现，此处跳过避免重复打扰
      if (reason instanceof ApiError) return;
      safeToast('发生未预期错误，请重试');
    };
    const onWindowError = (event: ErrorEvent): void => {
      console.error('[window error]', event.error ?? event.message);
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onWindowError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onWindowError);
    };
  }, [message]);

  return <></>;
}
