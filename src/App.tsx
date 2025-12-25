import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import CalendarPage from "./pages/CalendarPage";
import TasksPage from "./pages/TasksPage";
import FinancePage from "./pages/FinancePage";
import FamilyPage from "./pages/FamilyPage";
import DocumentsPage from "./pages/DocumentsPage";
import MusicPage from "./pages/MusicPage";
import LinksPage from "./pages/LinksPage";
import SettingsPage from "./pages/SettingsPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { AppLoader } from "@/components/AppLoader";

const queryClient = new QueryClient();

const ProtectedRoute = () => {
  const { session, isLoading } = useAuth();
  if (isLoading) return <AppLoader />;
  if (!session) return <Navigate to="/auth" replace />;
  return <AppLayout />;
};

const AuthRoute = () => {
  const { session, isLoading } = useAuth();
  if (isLoading) return <AppLoader />;
  if (session) return <Navigate to="/" replace />;
  return <AuthPage />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthRoute />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/family" element={<FamilyPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/music" element={<MusicPage />} />
              <Route path="/links" element={<LinksPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
