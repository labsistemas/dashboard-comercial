import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Login from "./pages/Login";
import DashboardLayout from "./components/DashboardLayout";
import AdminDashboard from "./pages/AdminDashboard";
import TrafegoPage from "./pages/TrafegoPage";
import ComercialPage from "./pages/ComercialPage";
import AgenteComercialPage from "./pages/AgenteComercialPage";
import ResgatePage from "./pages/ResgatePage";
import AbandonoPage from "./pages/AbandonoPage";
import UsuariosPage from "./pages/UsuariosPage";
import NotFound from "./pages/NotFound";
import { UserRole } from "./types/dashboard";
import ProdutosPage from "./pages/ProdutosPage";
import { hasPermission } from "./lib/permissions";

const queryClient = new QueryClient();

const canAccessAdminDashboard = (user: { id?: string; role: UserRole; permissionClassId?: string | null; permissionFlags?: any } | null | undefined) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  return hasPermission(user as any, 'adminMetrics', 'read');
};

const hasAnyDashboardAccess = (user: { id?: string; role: UserRole; permissionClassId?: string | null; permissionFlags?: any } | null | undefined) => {
  if (!user) return false;
  if (canAccessAdminDashboard(user)) return true;
  if (hasPermission(user as any, 'traffic', 'read')) return true;
  if (hasPermission(user as any, 'commercial', 'read')) return true;
  if (hasPermission(user as any, 'products', 'read')) return true;
  if (user.role === 'gestor' || user.role === 'closer' || user.role === 'vendedor') return true;
  return false;
};

const getDashboardHomeForRole = (user: { id?: string; role: UserRole; permissionClassId?: string | null; permissionFlags?: any }) => {
  if (canAccessAdminDashboard(user)) return "/dashboard";
  const roleUser = { id: user.id || "", role: user.role, permissionClassId: user.permissionClassId, permissionFlags: user.permissionFlags };
  if (hasPermission(roleUser as any, 'traffic', 'read')) return "/dashboard/trafego";
  if (user.role === "closer") return "/dashboard/resgate";
  if (hasPermission(roleUser as any, 'commercial', 'read')) return "/dashboard/comercial";
  if (hasPermission(roleUser as any, 'products', 'read')) return "/dashboard/produtos";
  if (user.role === "gestor") return "/dashboard/trafego";
  if (user.role === "closer") return "/dashboard/resgate";
  if (user.role === "vendedor") return "/dashboard/comercial";
  return "/dashboard/sem-acesso";
};

function NoAccessPage() {
  return (
    <DashboardLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Sem acesso ao dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Seu perfil não possui permissões para nenhuma página do dashboard.
        </p>
      </div>
    </DashboardLayout>
  );
}

function DashboardHome() {
  const { user, isReady } = useAuth();
  if (!isReady) return <div className="dark min-h-screen bg-background text-foreground" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasAnyDashboardAccess(user)) return <Navigate to="/dashboard/sem-acesso" replace />;
  if (canAccessAdminDashboard(user)) return <AdminDashboard />;
  return <Navigate to={getDashboardHomeForRole(user)} replace />;
}

function DashboardRoute({
  roles,
  permission,
  children,
}: {
  roles?: UserRole[];
  permission?: { area: 'traffic' | 'commercial' | 'users' | 'products'; action?: 'read' | 'write' | 'create' | 'deactivate' | 'update' | 'delete' };
  children: React.ReactNode;
}) {
  const { user, isReady } = useAuth();
  if (!isReady) return <div className="dark min-h-screen bg-background text-foreground" />;
  if (!user) return <Navigate to="/login" replace />;
  const hasRoleAccess = !roles || roles.includes(user.role) || user.role === 'admin';
  const hasPermissionAccess = permission ? hasPermission(user as any, permission.area, permission.action || 'read') : false;
  if (!hasRoleAccess && !hasPermissionAccess) {
    return <Navigate to={getDashboardHomeForRole(user)} replace />;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<DashboardRoute><DashboardHome /></DashboardRoute>} />
            <Route path="/dashboard/trafego" element={<DashboardRoute roles={["admin", "gestor"]} permission={{ area: 'traffic', action: 'read' }}><TrafegoPage /></DashboardRoute>} />
            <Route path="/dashboard/comercial" element={<DashboardRoute roles={["admin", "vendedor"]} permission={{ area: 'commercial', action: 'read' }}><ComercialPage /></DashboardRoute>} />
            <Route path="/dashboard/produtos" element={<DashboardRoute roles={["vendedor", "gestor"]} permission={{ area: 'products', action: 'read' }}><ProdutosPage /></DashboardRoute>} />
            <Route path="/dashboard/agente-comercial" element={<DashboardRoute roles={["admin"]}><AgenteComercialPage /></DashboardRoute>} />
            <Route path="/dashboard/resgate" element={<DashboardRoute roles={["admin", "closer", "vendedor"]}><ResgatePage /></DashboardRoute>} />
            <Route path="/dashboard/abandono" element={<DashboardRoute roles={["admin"]}><AbandonoPage /></DashboardRoute>} />
            <Route path="/dashboard/usuarios" element={<DashboardRoute roles={["admin"]} permission={{ area: 'users', action: 'read' }}><UsuariosPage /></DashboardRoute>} />
            <Route path="/dashboard/sem-acesso" element={<NoAccessPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
