import React from 'react';

/**
 * 全局错误边界:任一视图组件渲染崩溃时,只降级该层,
 * 避免整页白屏(此前渲染期 JSON.parse 抛错会拖垮整个应用)。
 */
interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Witchcat Ops 渲染崩溃]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 40, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 200,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-rose)' }}>
            页面渲染出错
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 480, textAlign: 'center', wordBreak: 'break-all' }}>
            {this.state.error.message}
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8 }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
