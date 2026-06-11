import { VERSION } from "./runtime.mjs";

export function buildFeishuPostPayload(options = {}) {
  const model = options.model || "gpt-5";
  const family = options.family || "openai";
  const repo = requireOption(options, "repo");
  const branch = requireOption(options, "branch");
  const title = requireOption(options, "title");
  const link = requireOption(options, "link");
  const status = options.status || "已创建 PR/MR，等待 review";
  const effect = options.effect || "未填写";
  const nextStep = options.nextStep || "请 review diff，确认后 merge。";
  const provider = options.provider || inferProvider(link);

  return {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: `【AI ${provider}】${repo}`,
          content: [
            [{ tag: "text", text: `Model: ${model} / ${family}` }],
            [{ tag: "text", text: `Repo: ${repo}` }],
            [{ tag: "text", text: `Branch: ${branch}` }],
            [
              { tag: "text", text: "Title: " },
              { tag: "a", text: title, href: link }
            ],
            [{ tag: "text", text: `状态: ${status}` }],
            [{ tag: "text", text: `效果: ${effect}` }],
            [{ tag: "text", text: `下一步: ${nextStep}` }]
          ]
        }
      }
    }
  };
}

export async function notifyFeishu(options = {}) {
  const webhook = options.webhookUrl || process.env[options.webhookEnv || "FEISHU_WEBHOOK_URL"];
  const payload = buildFeishuPostPayload(options);
  if (options.dryRun) {
    return {
      version: VERSION,
      channel: "feishu",
      dryRun: true,
      payload
    };
  }
  if (!webhook) {
    throw new Error(`Missing Feishu webhook. Set ${options.webhookEnv || "FEISHU_WEBHOOK_URL"}.`);
  }
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    version: VERSION,
    channel: "feishu",
    status: response.status,
    ok: response.ok && (body.code === 0 || body.StatusCode === 0),
    response: body
  };
}

function requireOption(options, name) {
  const value = options[name];
  if (!value || value === true) {
    throw new Error(`Missing required ${name}.`);
  }
  return String(value);
}

function inferProvider(link) {
  if (String(link).includes("gitlab")) return "MR";
  return "PR";
}
