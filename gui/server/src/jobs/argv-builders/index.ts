import type { JobRequest } from "../../../../shared/src/index";
import { buildAgentCatalogRename } from "./agent-catalog-rename";
import { buildAgentCatalogs } from "./agent-catalogs";
import { buildAgentDestroy } from "./agent-destroy";
import { buildAgentExport } from "./agent-export";
import { buildAgentInit } from "./agent-init";
import { buildAgentInstall } from "./agent-install";
import { buildAgentInstallAll } from "./agent-install-all";
import { buildAgentList } from "./agent-list";
import { buildAgentReconfigure } from "./agent-reconfigure";
import { buildAgentRegister } from "./agent-register";
import { buildAgentSync } from "./agent-sync";
import { buildAgentUninstall } from "./agent-uninstall";
import { buildAgentUninstallAll } from "./agent-uninstall-all";
import { buildAgentUnregister } from "./agent-unregister";
import { buildAgentValidate } from "./agent-validate";
import { buildDaemonStart } from "./daemon-start";
import { buildDaemonStop } from "./daemon-stop";
import { buildDoctor } from "./doctor";
import { buildInit } from "./init";
import { buildInitUser } from "./init-user";
import { buildJackOut } from "./jack-out";
import { buildKnowledgeAdd } from "./knowledge-add";
import { buildKnowledgeCompile } from "./knowledge-compile";
import { buildKnowledgeFetch } from "./knowledge-fetch";
import { buildKnowledgeList } from "./knowledge-list";
import { buildKnowledgeMigrateCodex } from "./knowledge-migrate-codex";
import { buildKnowledgeRemove } from "./knowledge-remove";
import { buildKnowledgeServe } from "./knowledge-serve";
import { buildKnowledgeValidate } from "./knowledge-validate";
import { buildSkillBootstrap } from "./skill-bootstrap";
import { buildSkillCatalogRename } from "./skill-catalog-rename";
import { buildSkillCatalogs } from "./skill-catalogs";
import { buildSkillInstall } from "./skill-install";
import { buildSkillList } from "./skill-list";
import { buildSkillRegister } from "./skill-register";
import { buildSkillSync } from "./skill-sync";
import { buildSkillUninstall } from "./skill-uninstall";
import { buildSkillUnregister } from "./skill-unregister";
import { buildSkillUpdate } from "./skill-update";
import { buildSkillValidate } from "./skill-validate";
import { buildStatus } from "./status";
import type { BuiltArgv } from "./types";
import { buildUpdate } from "./update";

export function buildArgv(req: JobRequest): BuiltArgv {
  switch (req.command) {
    case "init":
      return buildInit();
    case "init-user":
      return buildInitUser();
    case "status":
      return buildStatus();
    case "doctor":
      return buildDoctor(req);
    case "agent.list":
      return buildAgentList();
    case "agent.init":
      return buildAgentInit(req);
    case "agent.validate":
      return buildAgentValidate(req);
    case "agent.install":
      return buildAgentInstall(req);
    case "agent.install-all":
      return buildAgentInstallAll(req);
    case "agent.uninstall":
      return buildAgentUninstall(req);
    case "agent.uninstall-all":
      return buildAgentUninstallAll(req);
    case "agent.reconfigure":
      return buildAgentReconfigure(req);
    case "agent.destroy":
      return buildAgentDestroy(req);
    case "agent.export":
      return buildAgentExport(req);
    case "skill.register":
      return buildSkillRegister(req);
    case "skill.unregister":
      return buildSkillUnregister(req);
    case "skill.list":
      return buildSkillList(req);
    case "skill.catalogs":
      return buildSkillCatalogs();
    case "skill.catalog-rename":
      return buildSkillCatalogRename(req);
    case "skill.bootstrap":
      return buildSkillBootstrap(req);
    case "skill.install":
      return buildSkillInstall(req);
    case "skill.update":
      return buildSkillUpdate(req);
    case "skill.uninstall":
      return buildSkillUninstall(req);
    case "agent.register":
      return buildAgentRegister(req);
    case "agent.unregister":
      return buildAgentUnregister(req);
    case "agent.catalogs":
      return buildAgentCatalogs();
    case "agent.catalog-rename":
      return buildAgentCatalogRename(req);
    case "knowledge.add":
      return buildKnowledgeAdd(req);
    case "knowledge.remove":
      return buildKnowledgeRemove(req);
    case "knowledge.list":
      return buildKnowledgeList(req);
    case "knowledge.fetch":
      return buildKnowledgeFetch(req);
    case "knowledge.validate":
      return buildKnowledgeValidate(req);
    case "knowledge.compile":
      return buildKnowledgeCompile(req);
    case "knowledge.serve":
      return buildKnowledgeServe(req);
    case "daemon.start":
      return buildDaemonStart(req);
    case "daemon.stop":
      return buildDaemonStop();
    case "skill.validate":
      return buildSkillValidate(req);
    case "update":
      return buildUpdate(req);
    case "knowledge.migrate-codex":
      return buildKnowledgeMigrateCodex(req);
    case "jack-out":
      return buildJackOut(req);
    case "agent.sync":
      return buildAgentSync(req);
    case "skill.sync":
      return buildSkillSync(req);
    default: {
      // All commands have builders. This default exists to give TypeScript
      // an exhaustiveness anchor and to fail loudly if a new JobRequest
      // variant is added without a corresponding builder.
      const _exhaustive: never = req;
      throw new Error(
        `buildArgv: no builder registered for command '${(_exhaustive as { command: string }).command}'`,
      );
    }
  }
}

export type { BuiltArgv } from "./types";
