import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { JobCompletionListener } from "@/panels/JobCompletionListener/JobCompletionListener";
import { useDetectPlatformCli } from "@/hooks/useDetectPlatformCli";
import { useDaemonRestartToast } from "@/hooks/useDaemonRestartToast";
import { useDaemonStalenessToast } from "@/hooks/useDaemonStalenessToast";
import { JobStreamModal } from "@/panels/JobStreamModal/JobStreamModal";
import { captureToken } from "./api/client";
import { AgentEditor } from "./routes/AgentEditor";
import { AgentNew } from "./routes/AgentNew";
import { AgentsList } from "./routes/Agents";
import { AtlassianSetup } from "./routes/AtlassianSetup";
import { CatalogRegister } from "./routes/CatalogRegister";
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
import { SkillNew } from "./routes/SkillNew";
import { Skills } from "./routes/Skills";
import { Update } from "./routes/Update";
import { AppNav } from "./ui/AppNav";
import { TopBar } from "./ui/TopBar";

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
            <Route path="/agents/new" element={<AgentNew />} />
            <Route path="/agents/install-matrix" element={<InstallMatrix />} />
            <Route path="/agents/:name" element={<AgentEditor />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/skills/new" element={<SkillNew />} />
            <Route path="/skills/:name" element={<SkillEditor />} />
            <Route path="/catalogs" element={<Catalogs />} />
            <Route path="/catalogs/register" element={<CatalogRegister />} />
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
