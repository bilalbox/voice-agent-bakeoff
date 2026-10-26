/**
 * Push ApplianceOps Retell agent config from the repo in one shot:
 *   retell/agent-prompt.md
 *   retell/custom-functions.json
 *   retell/agent.config.json
 *
 * Usage:
 *   set RETELL_API_KEY=...
 *   npm run retell:sync              # create or update
 *   npm run retell:sync -- --dry-run # print payloads only
 *   npm run retell:sync -- --create  # force new LLM + agent
 *
 * Optional env:
 *   RETELL_LLM_ID / RETELL_AGENT_ID — override retell/.sync-state.json
 *   RETELL_VOICE_ID — override agent.config.json voice_id
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Retell from "retell-sdk";
import { buildConversationFlowDoc, withSlashIpa } from "./export-import.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const retellDir = join(__dirname, "..");
const repoRoot = join(__dirname, "../../..");
const statePath = join(retellDir, ".sync-state.json");

loadEnv({ path: join(repoRoot, ".env") });
loadEnv({ path: join(repoRoot, "apps", "edge", ".dev.vars") });

type CustomFnFile = {
  functions: Array<{
    name: string;
    description: string;
    url: string;
    method?: string;
    timeout_ms?: number;
    parameters: {
      type: "object";
      required?: string[];
      properties: Record<string, unknown>;
    };
  }>;
  inbound_webhook?: { url: string };
};

type AgentConfig = {
  agent_name: string;
  version_description?: string;
  voice_id: string;
  language?: string;
  llm_model?: string;
  responsiveness?: number;
  interruption_sensitivity?: number;
  begin_message?: string;
  dispatcher_phone_number?: string;
  include_transfer_tool?: boolean;
  default_dynamic_variables?: Record<string, string>;
  boosted_keywords?: string[];
  pronunciation_dictionary?: Array<{
    word: string;
    alphabet: "ipa" | "cmu" | "pinyin" | "jyutping";
    phoneme: string;
  }>;
  phone_number_e164?: string | null;
  include_end_call_tool?: boolean;
  speak_during_tool_execution?: boolean;
};

type SyncState = {
  llm_id?: string;
  agent_id?: string;
  conversation_flow_id?: string;
  response_engine_type?: "conversation-flow" | "retell-llm";
  updated_at?: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes("--dry-run"),
    forceCreate: argv.includes("--create"),
  };
}

const STATIC_EXECUTION_MESSAGES: Record<string, string> = {
  check_tech_availability: "One moment while I check our schedule.",
  book_appointment: "One moment while I lock that in on the schedule.",
  cancel_appointment: "One moment while I look up that appointment.",
  reschedule_parts_install: "One moment while I check the parts status.",
};

function buildGeneralTools(
  fns: CustomFnFile["functions"],
  cfg: AgentConfig,
) {
  const speak = cfg.speak_during_tool_execution !== false;
  const custom = fns.map((fn) => ({
    type: "custom" as const,
    name: fn.name,
    description: fn.description,
    url: fn.url,
    method: (fn.method?.toUpperCase() ?? "POST") as
      | "GET"
      | "POST"
      | "PUT"
      | "PATCH"
      | "DELETE",
    timeout_ms: fn.timeout_ms ?? 10000,
    parameters: fn.parameters,
    parameter_type: "json" as const,
    speak_during_execution: speak,
    speak_after_execution: true,
    execution_message_type: "static_text" as const,
    execution_message_description:
      STATIC_EXECUTION_MESSAGES[fn.name] ??
      "One moment while I check that in our system.",
  }));

  const tools: Array<Record<string, unknown>> = [...custom];

  if (cfg.include_transfer_tool !== false) {
    tools.unshift({
      type: "transfer_call" as const,
      name: "transfer_to_dispatcher",
      description:
        "Transfer the caller to a human dispatcher when requested, when verification cannot be completed, or when an unsupported request needs human escalation.",
      transfer_destination: {
        type: "predefined" as const,
        number:
          process.env.DISPATCHER_PHONE_NUMBER ??
          cfg.dispatcher_phone_number ??
          "+15550100000",
      },
      transfer_option: {
        type: "cold_transfer" as const,
      },
      speak_during_execution: true,
      execution_message_description:
        "Please hold while I connect you with a dispatcher.",
      execution_message_type: "static_text" as const,
    });
  }

  if (cfg.include_end_call_tool !== false) {
    tools.unshift({
      type: "end_call" as const,
      name: "end_call",
      description: "End the call when the caller is done or says goodbye.",
    });
  }

  return tools;
}

async function main() {
  const { dryRun, forceCreate } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey && !dryRun) {
    throw new Error(
      "RETELL_API_KEY is required. Put it in .env or apps/edge/.dev.vars",
    );
  }

  const prompt = readFileSync(join(retellDir, "agent-prompt.md"), "utf8").trim();
  const functionsFile = readJson<CustomFnFile>(
    join(retellDir, "custom-functions.json"),
  );
  const cfg = readJson<AgentConfig>(join(retellDir, "agent.config.json"));
  const state: SyncState = existsSync(statePath) ? readJson(statePath) : {};

  const voiceId = process.env.RETELL_VOICE_ID ?? cfg.voice_id;
  if (!dryRun && (!voiceId || voiceId.startsWith("REPLACE_"))) {
    throw new Error(
      "Set voice_id in retell/agent.config.json (or RETELL_VOICE_ID). Copy from Retell Dashboard → Voices.",
    );
  }

  const llmId =
    process.env.RETELL_LLM_ID ?? (forceCreate ? undefined : state.llm_id);
  const agentId =
    process.env.RETELL_AGENT_ID ?? (forceCreate ? undefined : state.agent_id);
  const flowId =
    process.env.RETELL_CONVERSATION_FLOW_ID ??
    (forceCreate ? undefined : state.conversation_flow_id);

  const client = dryRun ? null : new Retell({ apiKey: apiKey! });

  let existingAgent: any = null;
  if (client && agentId) {
    try {
      existingAgent = await client.agent.retrieve(agentId);
    } catch (err: any) {
      console.warn(`Could not retrieve agent ${agentId} (${err.message}), will treat as new.`);
    }
  }

  const isConversationFlow =
    existingAgent?.response_engine_type === "conversation-flow" ||
    existingAgent?.response_engine?.type === "conversation-flow" ||
    (!existingAgent && !llmId && Boolean(flowId));

  if (isConversationFlow) {
    const targetFlowId =
      (existingAgent?.response_engine as any)?.conversation_flow_id ||
      flowId;

    console.log(
      dryRun
        ? "Dry run — payloads only (no API calls)\n"
        : "Syncing Retell Conversation Flow + agent from retell/ …\n",
    );

    const { importDoc, conversationFlow } = buildConversationFlowDoc(retellDir);
    const outImportPath = join(retellDir, "ApplianceOps Conversation Flow.import.json");
    writeFileSync(outImportPath, JSON.stringify(importDoc, null, 2) + "\n", "utf8");

    const agentPayload = {
      agent_name: cfg.agent_name,
      version_description: cfg.version_description,
      voice_id: voiceId,
      language: cfg.language as "en-US" | undefined,
      responsiveness: cfg.responsiveness,
      interruption_sensitivity: cfg.interruption_sensitivity,
      boosted_keywords: cfg.boosted_keywords,
      pronunciation_dictionary: (cfg.pronunciation_dictionary ?? []).map((e) => ({
        word: e.word,
        alphabet: e.alphabet,
        phoneme: withSlashIpa(e.phoneme),
      })),
    };

    console.log(
      JSON.stringify(
        {
          engine: "conversation-flow",
          conversation_flow_id: targetFlowId,
          agent_id: agentId,
          tools: functionsFile.functions.map((f) => f.name),
          inbound_webhook: functionsFile.inbound_webhook?.url,
          phone_number_e164: cfg.phone_number_e164,
        },
        null,
        2,
      ),
    );

    if (dryRun) {
      console.log("\n--- conversation_flow payload ---\n", JSON.stringify(conversationFlow, null, 2));
      console.log("\n--- agent payload ---\n", JSON.stringify(agentPayload, null, 2));
      return;
    }

    if (targetFlowId && client) {
      await client.conversationFlow.update(targetFlowId, {
        global_prompt: conversationFlow.global_prompt,
        nodes: conversationFlow.nodes,
        tools: conversationFlow.tools,
        start_node_id: conversationFlow.start_node_id,
        start_speaker: conversationFlow.start_speaker,
        model_config: conversationFlow.model_config,
        tool_call_strict_mode: conversationFlow.tool_call_strict_mode,
      });
      console.log(`Updated conversation flow ${targetFlowId}`);
    }

    let nextAgentId = agentId;
    if (client) {
      if (nextAgentId) {
        await client.agent.update(nextAgentId, agentPayload);
        console.log(`Updated agent ${nextAgentId}`);
      } else if (targetFlowId) {
        const created = await client.agent.create({
          ...agentPayload,
          response_engine: {
            type: "conversation-flow",
            conversation_flow_id: targetFlowId,
          },
        });
        nextAgentId = created.agent_id;
        console.log(`Created agent ${nextAgentId}`);
      }

      const phone = cfg.phone_number_e164;
      const inboundUrl = functionsFile.inbound_webhook?.url;
      if (phone && inboundUrl && nextAgentId) {
        await client.phoneNumber.update(phone, {
          inbound_webhook_url: inboundUrl,
          inbound_agent_id: nextAgentId,
        });
        console.log(`Updated phone ${phone} inbound webhook → ${inboundUrl}`);
      } else if (inboundUrl) {
        console.log(
          `\nSet inbound webhook on your Retell phone number to:\n  ${inboundUrl}\n(or set phone_number_e164 in retell/agent.config.json and re-run)`,
        );
      }
    }

    const nextState: SyncState = {
      agent_id: nextAgentId,
      conversation_flow_id: targetFlowId,
      response_engine_type: "conversation-flow",
      updated_at: new Date().toISOString(),
    };
    writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n");
    console.log(`\nWrote ${statePath}`);
    if (nextAgentId) {
      console.log(`Dashboard: https://dashboard.retellai.com/agents/${nextAgentId}`);
    }
    console.log("Conversation flow, pronunciation dictionary & boosted_keywords synced on Retell.");
    return;
  }

  const llmBody = {
    model: cfg.llm_model ?? "gpt-4o",
    general_prompt: prompt,
    general_tools: buildGeneralTools(functionsFile.functions, cfg),
    begin_message: cfg.begin_message ?? "",
    default_dynamic_variables: cfg.default_dynamic_variables,
    start_speaker: "agent" as const,
  };

  const agentBody = {
    agent_name: cfg.agent_name,
    version_description: cfg.version_description,
    voice_id: voiceId,
    language: cfg.language as "en-US" | undefined,
    responsiveness: cfg.responsiveness,
    interruption_sensitivity: cfg.interruption_sensitivity,
    boosted_keywords: cfg.boosted_keywords,
    pronunciation_dictionary: (cfg.pronunciation_dictionary ?? []).map((e) => ({
      word: e.word,
      alphabet: e.alphabet,
      phoneme: withSlashIpa(e.phoneme),
    })),
    response_engine: {
      type: "retell-llm" as const,
      llm_id: llmId ?? "{{pending}}",
    },
  };

  console.log(
    dryRun
      ? "Dry run — payloads only (no API calls)\n"
      : "Syncing Retell LLM + agent from retell/ …\n",
  );
  console.log(
    JSON.stringify(
      {
        mode: llmId ? "update-llm" : "create-llm",
        agentMode: agentId ? "update-agent" : "create-agent",
        tools: functionsFile.functions.map((f) => f.name),
        inbound_webhook: functionsFile.inbound_webhook?.url,
        phone_number_e164: cfg.phone_number_e164,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    console.log("\n--- llm payload ---\n", JSON.stringify(llmBody, null, 2));
    console.log("\n--- agent payload ---\n", JSON.stringify(agentBody, null, 2));
    return;
  }

  if (!client) return;

  let nextLlmId = llmId;
  if (nextLlmId) {
    await client.llm.update(nextLlmId, llmBody);
    console.log(`Updated LLM ${nextLlmId}`);
  } else {
    const created = await client.llm.create(llmBody);
    nextLlmId = created.llm_id;
    console.log(`Created LLM ${nextLlmId}`);
  }

  const agentPayload = {
    ...agentBody,
    response_engine: { type: "retell-llm" as const, llm_id: nextLlmId },
  };

  let nextAgentId = agentId;
  if (nextAgentId) {
    await client.agent.update(nextAgentId, agentPayload);
    console.log(`Updated agent ${nextAgentId}`);
  } else {
    const created = await client.agent.create(agentPayload);
    nextAgentId = created.agent_id;
    console.log(`Created agent ${nextAgentId}`);
  }

  const phone = cfg.phone_number_e164;
  const inboundUrl = functionsFile.inbound_webhook?.url;
  if (phone && inboundUrl) {
    await client.phoneNumber.update(phone, {
      inbound_webhook_url: inboundUrl,
      inbound_agent_id: nextAgentId,
    });
    console.log(`Updated phone ${phone} inbound webhook → ${inboundUrl}`);
  } else if (inboundUrl) {
    console.log(
      `\nSet inbound webhook on your Retell phone number to:\n  ${inboundUrl}\n(or set phone_number_e164 in retell/agent.config.json and re-run)`,
    );
  }

  const nextState: SyncState = {
    llm_id: nextLlmId,
    agent_id: nextAgentId,
    response_engine_type: "retell-llm",
    updated_at: new Date().toISOString(),
  };
  writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n");
  console.log(`\nWrote ${statePath}`);
  console.log(
    `Dashboard: https://dashboard.retellai.com/agents/${nextAgentId}`,
  );
  console.log(
    "Pronunciation dictionary + boosted_keywords synced on the agent.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
