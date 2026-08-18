import { lazy, Suspense, useEffect } from "react";
import { useAppearance, ACCENT_COLORS } from "@/features/settings/appearanceStore";
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
import SettingsPage from "./pages/SettingsPage";
import HabitsPage from "./pages/HabitsPage";
import JournalPage from "./pages/JournalPage";
import ChatPage from "./pages/ChatPage";
import ProjectWorkspacePage, { DemoProjectWorkspacePage } from "./pages/ProjectWorkspacePage";

const ProjectsIndexPage = lazy(() => import("./pages/ProjectsIndexPage"));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage"));
const PhotosPage    = lazy(() => import("./pages/PhotosPage"));
const MusicPage     = lazy(() => import("./pages/MusicPage"));
const LearnAIPage   = lazy(() => import("./pages/LearnAIPage"));
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import OfflinePage from "./pages/OfflinePage";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { MusicPlayerProvider } from "@/providers/MusicPlayerProvider";
import { PlaylistPlayerProvider } from "@/contexts/PlaylistPlayerContext";
import { AppLoader } from "@/components/AppLoader";
import { LanguageProvider } from "@/components/LanguageProvider";
import { FlowAIOrbPlayground } from "@/components/FlowAIOrb";
import { MicroBreaksDevHarness } from "@/features/micro-breaks/components/MicroBreaksDevHarness";
import { SmartflowLanding } from "@/components/smartflow";

function AccentColorInit() {
  const { accentColor } = useAppearance();
  useEffect(() => {
    const { hsl } = ACCENT_COLORS[accentColor];
    document.documentElement.style.setProperty('--primary', hsl);
  }, [accentColor]);
  return null;
}

const queryClient = new QueryClient();
const TutorPage = lazy(() => import("./pages/TutorPage"));
const TutorAppPage = lazy(() => import("./pages/TutorAppPage"));
const TutorWisoPage = lazy(() => import("./pages/TutorWisoPage"));
const TutorErgaenzungspruefungPage = lazy(() => import("./pages/TutorErgaenzungspruefungPage"));
const MepSimulationPage = lazy(() => import("./pages/MepSimulationPage"));
const HabitDetailPage = lazy(() => import("./pages/HabitDetailPage"));
const WeeklyBriefingPage = lazy(() => import("./pages/WeeklyBriefingPage"));

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
      <MusicPlayerProvider>
      <PlaylistPlayerProvider>
      <TooltipProvider>
        <LanguageProvider>
        <AccentColorInit />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {import.meta.env.DEV && (
              <Route path="/__dev/flow-ai-orb" element={<FlowAIOrbPlayground />} />
            )}
            {import.meta.env.DEV && (
              <Route path="/__dev/micro-breaks-harness" element={<MicroBreaksDevHarness />} />
            )}
            <Route path="/smartflow-preview" element={<SmartflowLanding />} />
            <Route path="/auth" element={<AuthRoute />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/family" element={<FamilyPage />} />
              <Route path="/documents" element={<Suspense fallback={<AppLoader />}><DocumentsPage /></Suspense>} />
              <Route path="/music"     element={<Suspense fallback={<AppLoader />}><MusicPage /></Suspense>} />
              <Route path="/photos"   element={<Suspense fallback={<AppLoader />}><PhotosPage /></Suspense>} />
              <Route path="/learn-ai" element={<Suspense fallback={<AppLoader />}><LearnAIPage /></Suspense>} />
              <Route
                path="/tutor"
                element={
                  <Suspense fallback={<AppLoader />}>
                    <TutorPage />
                  </Suspense>
                }
              />
              <Route
                path="/tutor/app"
                element={
                  <Suspense fallback={<AppLoader />}>
                    <TutorAppPage />
                  </Suspense>
                }
              />
              <Route
                path="/tutor/wiso"
                element={
                  <Suspense fallback={<AppLoader />}>
                    <TutorWisoPage />
                  </Suspense>
                }
              />
              <Route
                path="/tutor/ergaenzungspruefung"
                element={
                  <Suspense fallback={<AppLoader />}>
                    <TutorErgaenzungspruefungPage />
                  </Suspense>
                }
              />
              <Route
                path="/tutor/mep-simulation"
                element={
                  <Suspense fallback={<AppLoader />}>
                    <MepSimulationPage />
                  </Suspense>
                }
              />
              <Route path="/habits" element={<HabitsPage />} />
              <Route path="/habits/:id" element={<Suspense fallback={<AppLoader />}><HabitDetailPage /></Suspense>} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/briefing/weekly" element={<Suspense fallback={<AppLoader />}><WeeklyBriefingPage /></Suspense>} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/projects" element={<Suspense fallback={<AppLoader />}><ProjectsIndexPage /></Suspense>} />
              <Route path="/projects/demo/smartflow" element={<DemoProjectWorkspacePage />} />
              <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="/offline" element={<OfflinePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
      </TooltipProvider>
      </PlaylistPlayerProvider>
      </MusicPlayerProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
