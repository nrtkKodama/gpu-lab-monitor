import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AlertTriangle } from 'lucide-react';

// Simple Error Boundary to catch UI crashes
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("UI Error Caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-8 max-w-lg w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <AlertTriangle size={32} />
              <h1 className="text-xl font-bold">アプリケーションエラーが発生しました</h1>
            </div>
            <p className="text-gray-300 mb-4">
              予期せぬエラーにより、UIの描画が中断されました。
            </p>
            <div className="bg-black/50 p-4 rounded-lg overflow-auto max-h-48 border border-red-900/30 mb-6">
              <code className="text-red-300 font-mono text-xs break-all">
                {this.state.error?.toString()}
              </code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition-colors"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);