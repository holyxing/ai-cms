import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// 路由 basename: 部署在 /admin/ 下
export const BASE_PATH = '/admin';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import App from './App';
import { bootstrapAppearance } from './stores/appearance';
import { bootstrapAuth, useAuthStore } from './stores/auth';
import './index.css';

// 启动时立即应用外观 (避免主色闪烁)
bootstrapAppearance();
// P4.1: 同步 hydrate auth store (从 localStorage 读 token setState)
//       然后等 rehydrate 完成再 render React, 防 AppLayout useQuery 在 ProtectedRoute
//       检查前发请求 -> 401 -> logout() 覆盖 store 的 race condition
bootstrapAuth();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function renderApp() {
  const rootEl = document.getElementById('root');
  if (!rootEl || rootEl.hasChildNodes()) return;
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={BASE_PATH}>
          <App />
          <Toaster position="top-center" richColors />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

// 等 zustand persist rehydrate 完成再 render (sync storage 也包成 Promise)
const rehydratePromise = useAuthStore.persist.rehydrate() as Promise<void> | void;
if (rehydratePromise && typeof (rehydratePromise as any).then === 'function') {
  (rehydratePromise as Promise<void>).then(renderApp);
} else {
  renderApp();
}