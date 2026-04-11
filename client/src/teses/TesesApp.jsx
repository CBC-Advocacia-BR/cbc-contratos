import { useEffect } from 'react';
import { TesesAuthProvider, useTesesAuth } from './contexts/AuthContext';
import { useRoute, matchRoute } from './router';
import Layout from './components/layout/Layout';
import LoginPage from './pages/Login';
import NoProfilePage from './pages/NoProfile';
import DashboardPage from './pages/Dashboard';
import ModelsListPage from './pages/ModelsList';
import ModelEditorPage from './pages/ModelEditor';
import ResortsListPage from './pages/ResortsList';
import ResortEditorPage from './pages/ResortEditor';
import GeneratorPage from './pages/Generator';
import HistoryPage from './pages/History';
import NotificationsPage from './pages/Notifications';
import ApprovalsPage from './pages/Approvals';
import ThemesPage from './pages/Themes';
import UsersPage from './pages/Users';
import SettingsPage from './pages/Settings';
import VersionHistoryPage from './pages/VersionHistory';
import { Spinner } from './components/ui/Primitives';
import { syncApprovedModelsCache } from './lib/offlineCache';

function Router() {
  const { path } = useRoute();

  // Rotas dinâmicas (/models/:id, /resorts/:id, /versions/:id)
  const modelMatch = matchRoute(path, '/models/:id');
  if (modelMatch) return <ModelEditorPage modelId={modelMatch.id} />;
  const resortMatch = matchRoute(path, '/resorts/:id');
  if (resortMatch) return <ResortEditorPage resortId={resortMatch.id} />;
  const versionMatch = matchRoute(path, '/versions/:id');
  if (versionMatch) return <VersionHistoryPage modelId={versionMatch.id} />;

  const first = path.split('/').filter(Boolean)[0] || 'dashboard';
  switch (first) {
    case 'dashboard':     return <DashboardPage />;
    case 'generator':     return <GeneratorPage />;
    case 'history':       return <HistoryPage />;
    case 'models':        return <ModelsListPage />;
    case 'resorts':       return <ResortsListPage />;
    case 'approvals':     return <ApprovalsPage />;
    case 'themes':        return <ThemesPage />;
    case 'users':         return <UsersPage />;
    case 'settings':      return <SettingsPage />;
    case 'notifications': return <NotificationsPage />;
    default:              return <DashboardPage />;
  }
}

function AuthGate() {
  const { session, profile, loading } = useTesesAuth();

  // Sincroniza cache offline ao autenticar
  useEffect(() => {
    if (profile?.id) {
      syncApprovedModelsCache().catch(() => { /* ignora em offline */ });
    }
  }, [profile?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-300">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }
  if (!session) return <LoginPage />;
  if (!profile) return <NoProfilePage />;

  return (
    <Layout>
      <Router />
    </Layout>
  );
}

export default function TesesApp() {
  return (
    <TesesAuthProvider>
      <AuthGate />
    </TesesAuthProvider>
  );
}
