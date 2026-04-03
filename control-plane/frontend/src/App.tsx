import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingPage } from '@/components/shared/LoadingPage';

// Eagerly loaded: auth pages & initial landing (first paint)
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { TwoFAPage } from '@/pages/auth/TwoFAPage';
import { ProjectsListPage } from '@/pages/projects/ProjectsListPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Lazy-loaded: all other pages for optimal code splitting
const lazy = (importFn: () => Promise<{ [key: string]: React.ComponentType }>, name: string) =>
  React.lazy(() => importFn().then(m => ({ default: m[name] as React.ComponentType })));

// Schema
const TablesListPage = lazy(() => import('@/pages/schema/TablesListPage'), 'TablesListPage');
const TableEditorPage = lazy(() => import('@/pages/schema/TableEditorPage'), 'TableEditorPage');
const SchemaHistoryPage = lazy(() => import('@/pages/schema/SchemaHistoryPage'), 'SchemaHistoryPage');
const DBMapPage = lazy(() => import('@/pages/schema/DBMapPage'), 'DBMapPage');

// Data
const DataBrowserPage = lazy(() => import('@/pages/data/DataBrowserPage'), 'DataBrowserPage');
const RecordFormPage = lazy(() => import('@/pages/data/RecordFormPage'), 'RecordFormPage');
const ImportPage = lazy(() => import('@/pages/data/ImportPage'), 'ImportPage');
const DataExplorerPage = lazy(() => import('@/pages/data/DataExplorerPage'), 'DataExplorerPage');
const DataPipelinePage = lazy(() => import('@/pages/data/DataPipelinePage'), 'DataPipelinePage');

// API Builder
const EndpointsListPage = lazy(() => import('@/pages/api-builder/EndpointsListPage'), 'EndpointsListPage');
const EndpointEditorPage = lazy(() => import('@/pages/api-builder/EndpointEditorPage'), 'EndpointEditorPage');
const SDKPage = lazy(() => import('@/pages/api-builder/SDKPage'), 'SDKPage');
const SwaggerPage = lazy(() => import('@/pages/api-builder/SwaggerPage'), 'SwaggerPage');
const GraphQLPage = lazy(() => import('@/pages/api-builder/GraphQLPage'), 'GraphQLPage');
const APIPlaygroundPage = lazy(() => import('@/pages/api-builder/APIPlaygroundPage'), 'APIPlaygroundPage');

// SQL
const SQLConsolePage = lazy(() => import('@/pages/sql/SQLConsolePage'), 'SQLConsolePage');
const QueryBuilderPage = lazy(() => import('@/pages/sql/QueryBuilderPage'), 'QueryBuilderPage');

// Webhooks, Cron, Flows
const WebhooksListPage = lazy(() => import('@/pages/webhooks/WebhooksListPage'), 'WebhooksListPage');
const CronJobsListPage = lazy(() => import('@/pages/cron/CronJobsListPage'), 'CronJobsListPage');
const CronJobEditorPage = lazy(() => import('@/pages/cron/CronJobEditorPage'), 'CronJobEditorPage');
const FlowsListPage = lazy(() => import('@/pages/flows/FlowsListPage'), 'FlowsListPage');
const FlowEditorPage = lazy(() => import('@/pages/flows/FlowEditorPage'), 'FlowEditorPage');

// Dashboard
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage');
const DashboardsListPage = lazy(() => import('@/pages/dashboards-builder/DashboardsListPage'), 'DashboardsListPage');
const DashboardEditorPage = lazy(() => import('@/pages/dashboards-builder/DashboardEditorPage'), 'DashboardEditorPage');

// Analytics, Audit, Docs
const AnalyticsPage = lazy(() => import('@/pages/analytics/AnalyticsPage'), 'AnalyticsPage');
const AuditLogPage = lazy(() => import('@/pages/audit/AuditLogPage'), 'AuditLogPage');
const DocsPage = lazy(() => import('@/pages/docs/DocsPage'), 'DocsPage');

// Settings
const UsersPage = lazy(() => import('@/pages/settings/UsersPage'), 'UsersPage');
const InviteKeysPage = lazy(() => import('@/pages/settings/InviteKeysPage'), 'InviteKeysPage');
const APITokensPage = lazy(() => import('@/pages/settings/APITokensPage'), 'APITokensPage');
const ProjectSettingsPage = lazy(() => import('@/pages/settings/ProjectSettingsPage'), 'ProjectSettingsPage');
const SecurityPage = lazy(() => import('@/pages/settings/SecurityPage'), 'SecurityPage');
const BackupsPage = lazy(() => import('@/pages/settings/BackupsPage'), 'BackupsPage');
const PluginsPage = lazy(() => import('@/pages/settings/PluginsPage'), 'PluginsPage');
const SecretsPage = lazy(() => import('@/pages/settings/SecretsPage'), 'SecretsPage');
const MyNodesPage = lazy(() => import('@/pages/settings/MyNodesPage'), 'MyNodesPage');

// Profile, WebSocket
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'), 'ProfilePage');
const WebSocketPage = lazy(() => import('@/pages/websocket/WebSocketPage'), 'WebSocketPage');

// System (superadmin)
const AllProjectsPage = lazy(() => import('@/pages/system/AllProjectsPage'), 'AllProjectsPage');
const AllUsersPage = lazy(() => import('@/pages/system/AllUsersPage'), 'AllUsersPage');
const GlobalSettingsPage = lazy(() => import('@/pages/system/GlobalSettingsPage'), 'GlobalSettingsPage');
const NodesPage = lazy(() => import('@/pages/system/NodesPage'), 'NodesPage');
const HealthPage = lazy(() => import('@/pages/system/HealthPage'), 'HealthPage');
const ErrorsPage = lazy(() => import('@/pages/system/ErrorsPage'), 'ErrorsPage');
const RolesPage = lazy(() => import('@/pages/system/RolesPage'), 'RolesPage');
const UserDetailPage = lazy(() => import('@/pages/system/UserDetailPage'), 'UserDetailPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      placeholderData: keepPreviousData,
    },
  },
});

const S: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<LoadingPage />}>{children}</Suspense>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            {/* Public pages (no auth) */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/2fa" element={<TwoFAPage />} />

            <Route path="/docs" element={<S><DocsPage /></S>} />

            {/* App */}
            <Route element={<AppLayout />}>
              <Route path="/" element={<ProjectsListPage />} />
              <Route path="/profile" element={<S><ProfilePage /></S>} />
              <Route path="/projects/:slug/dashboard" element={<S><DashboardPage /></S>} />

              {/* Schema Manager */}
              <Route path="/projects/:slug/tables" element={<S><TablesListPage /></S>} />
              <Route path="/projects/:slug/tables/:name/schema" element={<S><TableEditorPage /></S>} />
              <Route path="/projects/:slug/tables/history" element={<S><SchemaHistoryPage /></S>} />

              {/* Data Manager */}
              <Route path="/projects/:slug/tables/:name/data" element={<S><DataBrowserPage /></S>} />
              <Route path="/projects/:slug/tables/:name/records/new" element={<S><RecordFormPage /></S>} />
              <Route path="/projects/:slug/tables/:name/records/:id" element={<S><RecordFormPage /></S>} />
              <Route path="/projects/:slug/tables/:name/import" element={<S><ImportPage /></S>} />

              {/* API Builder */}
              <Route path="/projects/:slug/endpoints" element={<S><EndpointsListPage /></S>} />
              <Route path="/projects/:slug/endpoints/new" element={<S><EndpointEditorPage /></S>} />
              <Route path="/projects/:slug/endpoints/:id" element={<S><EndpointEditorPage /></S>} />

              {/* GraphQL */}
              <Route path="/projects/:slug/graphql" element={<S><GraphQLPage /></S>} />

              {/* WebSocket */}
              <Route path="/projects/:slug/websocket" element={<S><WebSocketPage /></S>} />

              {/* SDK */}
              <Route path="/projects/:slug/sdk" element={<S><SDKPage /></S>} />

              {/* API Docs (Swagger) */}
              <Route path="/projects/:slug/api-docs" element={<S><SwaggerPage /></S>} />

              {/* Webhooks */}
              <Route path="/projects/:slug/webhooks" element={<S><WebhooksListPage /></S>} />

              {/* SQL Console */}
              <Route path="/projects/:slug/sql" element={<S><SQLConsolePage /></S>} />

              {/* Analytics */}
              <Route path="/projects/:slug/analytics" element={<S><AnalyticsPage /></S>} />

              {/* Data Explorer */}
              <Route path="/projects/:slug/explorer" element={<S><DataExplorerPage /></S>} />

              {/* Cron Jobs */}
              <Route path="/projects/:slug/cron" element={<S><CronJobsListPage /></S>} />
              <Route path="/projects/:slug/cron/:id" element={<S><CronJobEditorPage /></S>} />

              {/* Flows */}
              <Route path="/projects/:slug/flows" element={<S><FlowsListPage /></S>} />
              <Route path="/projects/:slug/flows/:id" element={<S><FlowEditorPage /></S>} />

              {/* Query Builder */}
              <Route path="/projects/:slug/query-builder" element={<S><QueryBuilderPage /></S>} />

              {/* DB Map */}
              <Route path="/projects/:slug/db-map" element={<S><DBMapPage /></S>} />

              {/* API Playground */}
              <Route path="/projects/:slug/api-playground" element={<S><APIPlaygroundPage /></S>} />

              {/* Pipelines */}
              <Route path="/projects/:slug/pipelines" element={<S><DataPipelinePage /></S>} />

              {/* Dashboards */}
              <Route path="/projects/:slug/dashboards" element={<S><DashboardsListPage /></S>} />
              <Route path="/projects/:slug/dashboards/:id" element={<S><DashboardEditorPage /></S>} />

              {/* Audit */}
              <Route path="/projects/:slug/audit" element={<S><AuditLogPage /></S>} />

              {/* Settings */}
              <Route path="/projects/:slug/settings/users" element={<S><UsersPage /></S>} />
              <Route path="/projects/:slug/settings/invites" element={<S><InviteKeysPage /></S>} />
              <Route path="/projects/:slug/settings/tokens" element={<S><APITokensPage /></S>} />
              <Route path="/projects/:slug/settings/project" element={<S><ProjectSettingsPage /></S>} />
              <Route path="/projects/:slug/settings/security" element={<S><SecurityPage /></S>} />
              <Route path="/projects/:slug/settings/backups" element={<S><BackupsPage /></S>} />
              <Route path="/projects/:slug/settings/secrets" element={<S><SecretsPage /></S>} />
              <Route path="/projects/:slug/settings/plugins" element={<S><PluginsPage /></S>} />

              {/* My Nodes (personal) */}
              <Route path="/settings/my-nodes" element={<S><MyNodesPage /></S>} />

              {/* Superadmin */}
              <Route path="/system/health" element={<S><HealthPage /></S>} />
              <Route path="/system/errors" element={<S><ErrorsPage /></S>} />
              <Route path="/system/nodes" element={<S><NodesPage /></S>} />
              <Route path="/system/projects" element={<S><AllProjectsPage /></S>} />
              <Route path="/system/users" element={<S><AllUsersPage /></S>} />
              <Route path="/system/users/:userId" element={<S><UserDetailPage /></S>} />
              <Route path="/system/roles" element={<S><RolesPage /></S>} />
              <Route path="/system/logs" element={<S><AuditLogPage /></S>} />
              <Route path="/system/settings" element={<S><GlobalSettingsPage /></S>} />

            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

