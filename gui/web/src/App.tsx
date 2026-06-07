import { useEffect } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { JobCompletionListener } from "@/panels/JobCompletionListener/JobCompletionListener";
import { useDetectPlatformCli } from "@/hooks/useDetectPlatformCli";
import { useDaemonRestartToast } from "@/hooks/useDaemonRestartToast";
import { useDaemonStalenessToast } from "@/hooks/useDaemonStalenessToast";
import { JobStreamModal } from "@/panels/JobStreamModal/JobStreamModal";
import { captureToken } from "./api/client";
import { AgentEditor } from "./routes/AgentEditor";
import { AgentsList } from "./routes/Agents";
import { AtlassianSetup } from "./routes/AtlassianSetup";
import { Catalogs } from "./routes/Catalogs";
import { Daemon } from "./routes/Daemon";
import { Dashboard } from "./routes/Dashboard";
import { DoctorScreen } from "./routes/Doctor";
import { InstallMatrix } from "./routes/InstallMatrix";
import { JackOut } from "./routes/JackOut";
import { JobHistory } from "./routes/JobHistory";
import { Knowledge } from "./routes/Knowledge";
import { ModelConfigScreen } from "./routes/ModelConfig";
import { Onboarding } from "./routes/Onboarding";
import { OnboardingGate } from "./routes/OnboardingGate";
import { KnowledgeAgentRedirect } from "./routes/Phase2Placeholders";
import { RefreshHistory } from "./routes/RefreshHistory";
import { RefreshHistoryIndex } from "./routes/RefreshHistoryIndex";
import { SettingsScreen } from "./routes/Settings";
import { SkillEditor } from "./routes/SkillEditor";
import { Skills } from "./routes/Skills";
import { Update } from "./routes/Update";
import { AppNav } from "./ui/AppNav";
import { TopBar } from "./ui/TopBar";

// Redirects /catalogs/register?registry=<X> → /catalogs?add=register&registry=<X>
// so deep links into the register flow preserve the skill/agent registry param.
function RedirectCatalogsRegister() {
  const [params] = useSearchParams();
  const registry = params.get("registry");
  const to = registry
    ? `/catalogs?add=register&registry=${encodeURIComponent(registry)}`
    : "/catalogs?add=register";
  return <Navigate to={to} replace />;
}

function DaemonStatusWatcher() {
  useDaemonStalenessToast();
  return null;
}

function DaemonRestartWatcher() {
  useDaemonRestartToast();
  return null;
}

function PlatformCliWatcher() {
  useDetectPlatformCli();
  return null;
}

export function App() {
  useEffect(() => {
    captureToken();
  }, []);
  return (
    <div className="min-h-screen bg-matrix-black text-matrix-body flex flex-col">
      <OnboardingGate>
        <JobCompletionListener />
        <DaemonStatusWatcher />
        <DaemonRestartWatcher />
        <PlatformCliWatcher />
        <JobStreamModal />
        <TopBar />
        <div className="flex flex-1">
          <AppNav />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<AgentsList />} />
            <Route path="/agents/new" element={<Navigate to="/agents?add=true" replace />} />
            <Route path="/agents/install-matrix" element={<InstallMatrix />} />
            <Route path="/agents/:name" element={<AgentEditor />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/skills/new" element={<Navigate to="/skills?add=true" replace />} />
            <Route path="/skills/:name" element={<SkillEditor />} />
            <Route path="/catalogs" element={<Catalogs />} />
            <Route path="/catalogs/register" element={<RedirectCatalogsRegister />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/knowledge/refresh-history" element={<RefreshHistoryIndex />} />
            <Route path="/knowledge/:agent" element={<KnowledgeAgentRedirect />} />
            <Route path="/knowledge/:agent/refresh-history" element={<RefreshHistory />} />
            <Route path="/system/atlassian-setup" element={<AtlassianSetup />} />
            <Route path="/system/model-config" element={<ModelConfigScreen />} />
            <Route path="/system/doctor" element={<DoctorScreen />} />
            <Route path="/system/daemon" element={<Daemon />} />
            <Route path="/system/update" element={<Update />} />
            <Route path="/system/history" element={<JobHistory />} />
            <Route path="/system/jack-out" element={<JackOut />} />
            <Route path="/system/settings" element={<SettingsScreen />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </div>
      </OnboardingGate>
    </div>
  );
}
