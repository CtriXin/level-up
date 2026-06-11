import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

export function generateWorkPack(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const outputDir = join(runRoot, "work-pack");
  ensureDir(outputDir);

  const templatesDir = options.templatesDir
    ? resolve(options.templatesDir)
    : resolve(new URL("../templates", import.meta.url).pathname);
  const specTemplate = readFileSync(join(templatesDir, "SPEC.template.md"), "utf8");
  const todoTemplate = readFileSync(join(templatesDir, "TODO.template.md"), "utf8");
  const createdAt = new Date().toISOString();
  const context = buildTemplateContext(goal);
  const specPath = join(outputDir, "SPEC.md");
  const todoPath = join(outputDir, "TODO.md");
  const manifestPath = join(outputDir, "manifest.json");

  writeFileSync(specPath, renderTemplate(specTemplate, context));
  writeFileSync(todoPath, renderTemplate(todoTemplate, context));

  const manifest = {
    version: VERSION,
    runId: goal.runId,
    createdAt,
    files: {
      spec: specPath,
      todo: todoPath,
      manifest: manifestPath
    }
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

function buildTemplateContext(goal) {
  return {
    OBJECTIVE: goal.objective,
    TARGET_PATH: goal.target.path,
    BASE_HEAD: goal.target.head,
    RUN_ID: goal.runId,
    PRIMARY_METRIC: goal.primaryMetric.name,
    METRIC_DIRECTION: goal.primaryMetric.direction,
    METRIC_DESCRIPTION: goal.primaryMetric.description,
    GUARDRAILS: list(goal.guardrails),
    NON_GOALS: list(goal.nonGoals)
  };
}

function renderTemplate(template, context) {
  return Object.entries(context).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template
  );
}

function list(items = []) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function hasWorkPack(runRootInput) {
  const runRoot = resolve(runRootInput);
  return existsSync(join(runRoot, "work-pack", "SPEC.md")) && existsSync(join(runRoot, "work-pack", "TODO.md"));
}
