import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { Spin } from 'antd';
import type { User } from '@ai-review/shared/api';
import { fetchMe } from './api/auth';
import { AUTH_QUERY_KEY } from './hooks/use-auth';
import { queryClient } from './query-client';
import { AdminLayout } from './layouts/AdminLayout';
import { UserLayout } from './layouts/UserLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { ReportDetailView } from './views/ReportDetailView';
import { ReviewListView } from './views/ReviewListView';
import { RunReviewView } from './views/RunReviewView';
import { StatisticsView } from './views/StatisticsView';

type RouterContext = { queryClient: QueryClient };

/** 路由守卫共享逻辑：未登录 → 登录页（携带回跳地址） */
async function requireUser(context: RouterContext, href: string): Promise<User> {
  const user = await context.queryClient.fetchQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
  });
  if (user === null) throw redirect({ to: '/login', search: { redirect: href } });
  return user;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

/** /login 与 /register 共用的回跳参数校验（仅字符串，缺省时不产出键以适配 exactOptionalPropertyTypes） */
const redirectSearch = (search: Record<string, unknown>): { redirect?: string } => {
  if (typeof search.redirect !== 'string') return {};
  return { redirect: search.redirect };
};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: redirectSearch,
  component: LoginRoute,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  validateSearch: redirectSearch,
  component: RegisterRoute,
});

function LoginRoute(): ReactElement {
  const { redirect } = loginRoute.useSearch();
  return <LoginPage {...(redirect !== undefined ? { redirect } : {})} />;
}

function RegisterRoute(): ReactElement {
  const { redirect } = registerRoute.useSearch();
  return <RegisterPage {...(redirect !== undefined ? { redirect } : {})} />;
}

// —— 用户端（登录即可访问）。无路径布局路由：id 仅用于路由标识，不参与 URL 前缀 ——
const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: UserLayout,
  beforeLoad: ({ context, location }) => requireUser(context, location.href),
});

const homeRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/',
  component: HomePage,
});

const runRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/run',
  component: RunRoute,
});

function RunRoute(): ReactElement {
  const navigate = useNavigate();
  return (
    <RunReviewView
      onCompleted={(reviewId) => {
        if (reviewId !== '') {
          void navigate({ to: '/reviews/$reviewId', params: { reviewId } });
        }
      }}
    />
  );
}

const reviewsRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/reviews',
  component: ReviewsRoute,
});

function ReviewsRoute(): ReactElement {
  const navigate = useNavigate();
  return (
    <ReviewListView
      onOpen={(reviewId) => void navigate({ to: '/reviews/$reviewId', params: { reviewId } })}
    />
  );
}

const reviewDetailRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/reviews/$reviewId',
  component: ReviewDetailRoute,
});

function ReviewDetailRoute(): ReactElement {
  const { reviewId } = reviewDetailRoute.useParams();
  const navigate = useNavigate();
  return (
    <ReportDetailView reviewId={reviewId} onBack={() => void navigate({ to: '/reviews' })} />
  );
}

const statsRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/stats',
  component: StatisticsView,
});

const profileRoute = createRoute({
  getParentRoute: () => userRoute,
  path: '/profile',
  component: ProfilePage,
});

// —— 管理后台（仅 admin；非 admin 回用户端首页）——
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminLayout,
  beforeLoad: async ({ context, location }) => {
    const user = await requireUser(context, location.href);
    if (user.role !== 'admin') throw redirect({ to: '/' });
  },
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminOverviewPage,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: AdminUsersPage,
});

function NotFound(): ReactElement {
  return <div>404：页面不存在</div>;
}

export const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  userRoute.addChildren([
    homeRoute,
    runRoute,
    reviewsRoute,
    reviewDetailRoute,
    statsRoute,
    profileRoute,
  ]),
  adminRoute.addChildren([adminIndexRoute, adminUsersRoute]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPendingComponent: PendingFallback,
});

function PendingFallback(): ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
      <Spin tip="加载中…" />
    </div>
  );
}

// 渲染期补上 queryClient（保持 createRouter 的类型签名简单）
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
