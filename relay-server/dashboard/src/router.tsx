import {
  createRouter,
  createRootRoute,
  createRoute,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { OverviewPage } from './routes/Overview';
import { AgentsPage } from './routes/Agents';
import { AuditPage } from './routes/Audit';
import { SettingsPage } from './routes/Settings';

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: AgentsPage,
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AuditPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  agentsRoute,
  auditRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });
