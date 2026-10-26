/**
 * Build a Retell Conversation Flow agent import JSON from repo primitives.
 *
 * Flow shape (avoids dead-ends after function nodes):
 *   Welcome (conversation)
 *     → Check Availability (function) → Discuss → Book → Confirm → End
 *     → Collect cancel info → Cancel (function) → Confirm cancel → End
 *         (Confirm cancel may loop back to Cancel with confirmed=true for fee,
 *          or transition to Transfer to Dispatcher if verification fails/cap hit)
 *     → Reschedule parts (function) → End
 *     → Transfer to Dispatcher (transfer_call) → End
 *     → End
 *
 *   npm run retell:export
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const retellDir = join(__dirname, "..");
const repoRoot = join(__dirname, "../../..");
const outPath = join(retellDir, "ApplianceOps Conversation Flow.import.json");

loadEnv({ path: join(repoRoot, ".env") });
loadEnv({ path: join(repoRoot, "apps", "edge", ".dev.vars") });

type CustomFn = {
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
};

type CustomFnFile = {
  functions: CustomFn[];
  stack1_contrast?: {
    name: string;
    url: string;
    notes?: string;
  };
};

type AgentConfig = {
  agent_name: string;
  voice_id: string;
  language?: string;
  responsiveness?: number;
  interruption_sensitivity?: number;
  boosted_keywords?: string[];
  dispatcher_phone_number?: string;
  include_transfer_tool?: boolean;
  pronunciation_dictionary?: Array<{
    word: string;
    alphabet: "ipa" | "cmu" | "pinyin" | "jyutping";
    phoneme: string;
  }>;
  speak_during_tool_execution?: boolean;
  conversation_flow?: {
    model?: string;
    post_call_analysis_model?: string;
    include_slow_tool?: boolean;
    timezone?: string;
  };
};

type FlowTool = Record<string, unknown>;
type Edge = {
  id: string;
  destination_node_id: string;
  transition_condition: { type: "prompt"; prompt: string };
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function withSlashIpa(phoneme: string): string {
  const p = phoneme.trim();
  if (p.startsWith("/") && p.endsWith("/")) return p;
  return `/${p.replace(/^\/|\/$/g, "")}/`;
}

const STATIC_EXECUTION_MESSAGES: Record<string, string> = {
  check_tech_availability: "One moment while I check our schedule.",
  book_appointment: "One moment while I lock that in on the schedule.",
  cancel_appointment: "One moment while I look up that appointment.",
  reschedule_parts_install: "One moment while I check the parts status.",
  check_tech_availability_slow: "One moment while I query technician availability.",
};

function toolId(name: string, salt: number): string {
  return `tool-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${salt}`;
}

function toFlowTool(
  fn: CustomFn,
  opts: {
    speakDuring: boolean;
    /** If true, Retell narrates the tool JSON (can duplicate a following conversation node). */
    speakAfter: boolean;
    salt: number;
    description?: string;
    executionMessage?: string;
  },
) {
  return {
    args_at_root: false,
    description: opts.description ?? fn.description,
    enable_typing_sound: true,
    // static_text plays hardcoded filler without LLM inventing parameter speech
    execution_message_type: "static_text" as const,
    execution_message_description:
      opts.executionMessage ??
      STATIC_EXECUTION_MESSAGES[fn.name] ??
      "One moment while I check our schedule.",
    headers: {},
    max_retry: 0,
    method: (fn.method?.toUpperCase() ?? "POST") as string,
    name: fn.name,
    parameter_type: "json" as const,
    parameters: fn.parameters,
    query_params: {},
    response_variables: {},
    speak_after_execution: opts.speakAfter,
    speak_during_execution: opts.speakDuring,
    timeout_ms: fn.timeout_ms ?? 10000,
    tool_id: toolId(fn.name, opts.salt),
    type: "custom" as const,
    url: fn.url,
  };
}

function functionNode(opts: {
  id: string;
  name: string;
  toolId: string;
  x: number;
  y: number;
  speakDuringExecution: boolean;
  edges: Edge[];
}) {
  return {
    display_position: { x: opts.x, y: opts.y },
    edges: opts.edges,
    enable_typing_sound: true,
    id: opts.id,
    name: opts.name,
    skippable: false,
    speak_during_execution: opts.speakDuringExecution,
    tool_id: opts.toolId,
    tool_type: "local" as const,
    type: "function" as const,
    wait_for_result: true,
  };
}

function buildFlow(opts: {
  now: number;
  toolsByName: Map<string, FlowTool>;
  dispatcherPhone: string;
}) {
  const { now, toolsByName, dispatcherPhone } = opts;
  const welcomeId = `start-node-${now}`;
  const endId = `end-call-node-${now}`;
  const discussId = `node-discuss-availability-${now}`;
  const confirmId = `node-confirm-booking-${now}`;
  const collectCancelId = `node-collect-cancel-${now}`;
  const confirmCancelId = `node-confirm-cancel-${now}`;
  const transferId = `node-transfer-${now}`;

  const avail = toolsByName.get("check_tech_availability");
  const book = toolsByName.get("book_appointment");
  const parts = toolsByName.get("reschedule_parts_install");
  const cancel = toolsByName.get("cancel_appointment");
  if (!avail || !book || !parts || !cancel) {
    throw new Error(
      "custom-functions.json must define check_tech_availability, book_appointment, reschedule_parts_install, cancel_appointment",
    );
  }

  const availNodeId = `node-availability-${now}`;
  const bookNodeId = `node-book-${now}`;
  const partsNodeId = `node-parts-${now}`;
  const cancelNodeId = `node-cancel-${now}`;

  const welcome = {
    display_position: { x: 120, y: 40 },
    edges: [
      {
        destination_node_id: availNodeId,
        id: "edge-availability",
        transition_condition: {
          prompt:
            "Caller wants technician availability or open arrival windows for a supported appliance",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: partsNodeId,
        id: "edge-parts",
        transition_condition: {
          prompt:
            "Caller wants to reschedule a parts installation or asks about parts status",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: collectCancelId,
        id: "edge-cancel",
        transition_condition: {
          prompt: "Caller wants to cancel an appointment or job",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: transferId,
        id: "edge-welcome-transfer",
        transition_condition: {
          prompt:
            "Caller explicitly asks or agrees to be transferred to a dispatcher or human representative",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: endId,
        id: "edge-end",
        transition_condition: {
          prompt: "Caller is done, says goodbye, or declines further help",
          type: "prompt" as const,
        },
      },
    ],
    id: welcomeId,
    instruction: {
      text:
        "Greet once, in one short sentence. If known_caller is true and job_id is non-empty, say: Hi {{customer_name}}, are you calling about the {{appliance}} — job {{job_id}}? Otherwise say: Thanks for calling ApplianceOps. How can I help you today? If the caller asks you to repeat, says they didn't catch it, or asks what you said, say that same greeting again word for word, including ApplianceOps — never answer a repeat request with a menu of options. Never say {{appliance}} or {{job_id}} aloud when they are empty, and never invent an appliance or job number. If they ask for an unsupported appliance (e.g. pool heater, water heater, HVAC), decline immediately: state clearly that pool heater repair is not a service ApplianceOps offers, explain that we only service major kitchen and laundry appliances, do not search availability, and offer a human dispatcher or referral. If asked again or asked for a referral, recommend local specialists or offer a dispatcher. If they want availability, transition directly to Check Tech Availability. If they want to cancel, transition directly to collect cancel info.",
      type: "prompt" as const,
    },
    name: "Welcome",
    skippable: false,
    start_speaker: "agent" as const,
    type: "conversation" as const,
  };

  const collectCancel = {
    display_position: { x: 120, y: 560 },
    edges: [
      {
        destination_node_id: cancelNodeId,
        id: "edge-collect-to-cancel",
        transition_condition: {
          prompt:
            "Caller gave a job ID AND phone number, or gave their account phone number. Transition immediately to run cancel.",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: transferId,
        id: "edge-collect-cancel-transfer",
        transition_condition: {
          prompt: "Caller cannot verify or asks to speak with a dispatcher",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: endId,
        id: "edge-collect-cancel-end",
        transition_condition: {
          prompt: "Caller changed their mind or says goodbye without cancelling",
          type: "prompt" as const,
        },
      },
    ],
    id: collectCancelId,
    instruction: {
      text:
        "Collect both the job ID and the phone number on the account. Verification strictly requires two factors: a job ID and the matching account phone. Name alone is never sufficient. If caller gave only a job ID, ask: 'For security, what is the phone number on the account?' When they provide the phone number, transition immediately to Cancel without repeating parameter keys or tool names.",
      type: "prompt" as const,
    },
    name: "Collect cancel info",
    skippable: false,
    type: "conversation" as const,
  };

  const confirmCancel = {
    display_position: { x: 720, y: 560 },
    edges: [
      {
        destination_node_id: cancelNodeId,
        id: "edge-confirm-fee-to-cancel",
        transition_condition: {
          prompt:
            "Tool asked for fee confirmation and caller clearly said yes / proceed / cancel it / I accept the fee. Re-run Cancel with the same job_id and confirmed=true.",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: collectCancelId,
        id: "edge-confirm-cancel-retry",
        transition_condition: {
          prompt:
            "Verification required, mismatched phone, multiple jobs, or caller wants to try a different phone / job ID",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: transferId,
        id: "edge-confirm-cancel-transfer",
        transition_condition: {
          prompt:
            "Tool indicated attempt limit reached / transfer required, or caller repeatedly failed verification, or caller asks for a dispatcher",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: endId,
        id: "edge-confirm-cancel-end",
        transition_condition: {
          prompt:
            "Cancellation succeeded, caller declined the fee, or caller is done / goodbye",
          type: "prompt" as const,
        },
      },
    ],
    id: confirmCancelId,
    instruction: {
      text:
        "Read the cancel tool outcome in natural conversational English from speak_this or message. If verification failed or details do not match, do NOT reveal customer details (do not read name, appliance, or scheduled time). Speak the neutral message from speak_this. If tool returned verification_required, ask for the account phone and transition back to Collect cancel info. If fee_applicable and not cancelled, ask yes/no for the fee — on yes, transition back to Cancel with confirmed=true. If attempt limit reached or caller requests a dispatcher, transition to Transfer to Dispatcher. Never read raw JSON or parameter keys aloud.",
      type: "prompt" as const,
    },
    name: "Confirm cancel",
    skippable: false,
    type: "conversation" as const,
  };

  const discuss = {
    display_position: { x: 720, y: 40 },
    edges: [
      {
        destination_node_id: bookNodeId,
        id: "edge-discuss-to-book",
        transition_condition: {
          prompt:
            "Caller chose a technician (e.g. Lee in south / Ana / Rio) or said book/yes/go ahead for a visit",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: availNodeId,
        id: "edge-discuss-recheck",
        transition_condition: {
          prompt:
            "Caller wants different times, another zone, or to search availability again",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: transferId,
        id: "edge-discuss-transfer",
        transition_condition: {
          prompt: "Caller asks to speak to a dispatcher / human representative",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: endId,
        id: "edge-discuss-end",
        transition_condition: {
          prompt: "Caller is finished or says goodbye without booking",
          type: "prompt" as const,
        },
      },
    ],
    id: discussId,
    instruction: {
      text:
        "Speak availability results once in plain English: at most two technician options with day/time in Pacific. Ask which they prefer. If the requested service was unsupported, explain that we only service kitchen and laundry appliances and offer a transfer. When they pick a tech, transition directly to Book (pass tech_id and window_start from open_windows) — static filler plays automatically.",
      type: "prompt" as const,
    },
    name: "Discuss availability",
    skippable: false,
    type: "conversation" as const,
  };

  const confirm = {
    display_position: { x: 1100, y: 40 },
    edges: [
      {
        destination_node_id: endId,
        id: "edge-confirm-end",
        transition_condition: {
          prompt: "Caller is satisfied or says goodbye / thanks / that's all",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: discussId,
        id: "edge-confirm-retry",
        transition_condition: {
          prompt:
            "Booking failed, window unavailable, or caller wants a different technician/window",
          type: "prompt" as const,
        },
      },
      {
        destination_node_id: transferId,
        id: "edge-confirm-transfer",
        transition_condition: {
          prompt: "Caller asks to speak to a dispatcher or needs human assistance",
          type: "prompt" as const,
        },
      },
    ],
    id: confirmId,
    instruction: {
      text:
        "Read the booking tool result in plain English once: state the technician, Pacific time window, and job number from speak_this or message. If the window was unavailable, inform the caller and offer to pick another window. If the caller asks which phone number the appointment is under or on file, confirm the number on file from the booking (ending in 0000). Ask if they need anything else. Do not hang up until they say goodbye.",
      type: "prompt" as const,
    },
    name: "Confirm booking",
    skippable: false,
    type: "conversation" as const,
  };

  const transferNode = {
    display_position: { x: 720, y: 780 },
    edge: {
      destination_node_id: endId,
      id: "edge-transfer-to-end",
      transition_condition: {
        prompt: "Transfer failed",
        type: "prompt" as const,
      },
    },
    id: transferId,
    instruction: {
      text: "Please hold while I connect you with a dispatcher.",
      type: "static_text" as const,
    },
    name: "Transfer to Dispatcher",
    speak_during_execution: true,
    transfer_destination: {
      number: dispatcherPhone,
      type: "predefined" as const,
    },
    transfer_option: {
      type: "cold_transfer" as const,
    },
    type: "transfer_call" as const,
  };

  const endNode = {
    display_position: { x: 1100, y: 520 },
    id: endId,
    instruction: {
      text: "Thanks for calling ApplianceOps! Have a great day.",
      type: "static_text" as const,
    },
    name: "End Call",
    skippable: false,
    type: "end" as const,
  };

  return {
    start_node_id: welcomeId,
    nodes: [
      welcome,
      discuss,
      confirm,
      collectCancel,
      confirmCancel,
      transferNode,
      endNode,
      functionNode({
        id: availNodeId,
        name: "Check Tech Availability",
        toolId: avail.tool_id as string,
        x: 420,
        y: 40,
        speakDuringExecution: false,
        edges: [
          {
            id: "edge-avail-to-discuss",
            destination_node_id: discussId,
            transition_condition: {
              type: "prompt",
              prompt:
                "Availability tool finished (success, unsupported, or empty). Always continue here to discuss results with the caller.",
            },
          },
        ],
      }),
      functionNode({
        id: bookNodeId,
        name: "Book Appointment",
        toolId: book.tool_id as string,
        x: 960,
        y: 40,
        speakDuringExecution: false,
        edges: [
          {
            id: "edge-book-to-confirm",
            destination_node_id: confirmId,
            transition_condition: {
              type: "prompt",
              prompt:
                "Booking tool finished (success, unavailable window, or failure). Always continue to confirm the outcome with the caller — do not end the call yet.",
            },
          },
        ],
      }),
      functionNode({
        id: partsNodeId,
        name: "Reschedule Parts Install",
        toolId: parts.tool_id as string,
        x: 420,
        y: 320,
        speakDuringExecution: false,
        edges: [
          {
            id: "edge-parts-end",
            destination_node_id: endId,
            transition_condition: {
              type: "prompt",
              prompt: "Parts reschedule handled or caller is done",
            },
          },
        ],
      }),
      functionNode({
        id: cancelNodeId,
        name: "Cancel Appointment",
        toolId: cancel.tool_id as string,
        x: 420,
        y: 560,
        speakDuringExecution: false,
        edges: [
          {
            id: "edge-cancel-to-confirm",
            destination_node_id: confirmCancelId,
            transition_condition: {
              type: "prompt",
              prompt:
                "Cancel tool finished (verified, fee prompt, mismatch, or cap reached). Always continue to confirm the outcome — do not end the call yet.",
            },
          },
        ],
      }),
    ],
  };
}

export function buildConversationFlowDoc(baseDir = retellDir, now = Date.now()) {
  const prompt = readFileSync(join(baseDir, "agent-prompt.md"), "utf8");
  const fns = readJson<CustomFnFile>(join(baseDir, "custom-functions.json"));
  const cfg = readJson<AgentConfig>(join(baseDir, "agent.config.json"));
  const speakDuring = cfg.speak_during_tool_execution !== false;
  const cf = cfg.conversation_flow ?? {};
  const model = cf.model ?? "gpt-6-luna";
  const analysisModel = cf.post_call_analysis_model ?? "gpt-4.1";
  const dispatcherPhone =
    process.env.DISPATCHER_PHONE_NUMBER ??
    cfg.dispatcher_phone_number ??
    "+14155550100";

  // Static text filler during execution for all tools; conversation nodes handle post-tool speech.
  const tools: FlowTool[] = fns.functions.map((fn, i) => {
    return toFlowTool(fn, {
      speakDuring,
      speakAfter: false,
      salt: now + i,
      executionMessage: STATIC_EXECUTION_MESSAGES[fn.name],
    });
  });

  const availTool = tools.find((t) => t.name === "check_tech_availability");
  if (availTool) {
    availTool.speak_after_execution = false;
    availTool.speak_during_execution = false;
  }
  const bookTool = tools.find((t) => t.name === "book_appointment");
  if (bookTool) {
    bookTool.speak_during_execution = false;
    bookTool.speak_after_execution = false;
  }
  const cancelTool = tools.find((t) => t.name === "cancel_appointment");
  if (cancelTool) {
    cancelTool.speak_during_execution = false;
    cancelTool.speak_after_execution = false;
  }
  const partsTool = tools.find((t) => t.name === "reschedule_parts_install");
  if (partsTool) {
    partsTool.speak_during_execution = false;
    partsTool.speak_after_execution = false;
  }

  if (cf.include_slow_tool !== false && fns.stack1_contrast) {
    tools.push(
      toFlowTool(
        {
          name: fns.stack1_contrast.name,
          description:
            fns.stack1_contrast.notes ??
            "Uncached paginated availability (Stack 1 latency contrast)",
          url: fns.stack1_contrast.url,
          method: "POST",
          timeout_ms: 10000,
          parameters: fns.functions[0]?.parameters ?? {
            type: "object",
            properties: {},
          },
        },
        {
          speakDuring,
          speakAfter: false,
          salt: now + 99,
          description:
            fns.stack1_contrast.notes ??
            "Optional second agent or A/B tool URL to demo uncached pagination latency.",
        },
      ),
    );
  }

  const toolsByName = new Map(tools.map((t) => [t.name as string, t]));
  const { start_node_id, nodes } = buildFlow({
    now,
    toolsByName,
    dispatcherPhone,
  });

  const voiceId =
    process.env.RETELL_VOICE_ID ??
    (cfg.voice_id && !cfg.voice_id.startsWith("REPLACE_")
      ? cfg.voice_id
      : "retell-Nico");

  const importDoc = {
    agent_id: "",
    channel: "voice",
    last_modification_timestamp: now,
    agent_name: cfg.agent_name,
    response_engine: {
      conversation_flow_id: "",
      type: "conversation-flow",
      version: 0,
    },
    language: cfg.language ?? "en-US",
    data_storage_setting: "everything",
    contact_memory_config: {
      enable_read: true,
      enable_update: false,
    },
    opt_in_signed_url: false,
    version: 0,
    assigned_tags: [],
    is_published: false,
    post_call_analysis_model: analysisModel,
    pii_config: {
      categories: [],
      mode: "post_call",
    },
    handbook_config: {
      ai_disclosure: true,
      default_personality: true,
    },
    timezone: cf.timezone ?? "America/Los_Angeles",
    voice_id: voiceId,
    max_call_duration_ms: 3600000,
    interruption_sensitivity: cfg.interruption_sensitivity ?? 0.55,
    boosted_keywords: cfg.boosted_keywords ?? [],
    responsiveness: cfg.responsiveness ?? 0.65,
    pronunciation_dictionary: (cfg.pronunciation_dictionary ?? []).map((e) => ({
      alphabet: e.alphabet,
      phoneme: withSlashIpa(e.phoneme),
      word: e.word,
    })),
    voicemail_option: {
      action: { type: "hangup" },
    },
    allow_user_dtmf: true,
    user_dtmf_options: {},
    conversationFlow: {
      conversation_flow_id: "",
      version: 0,
      model_config: {
        type: "cascading",
        primary: {
          model,
          tier: "standard",
        },
      },
      last_modification_timestamp: now,
      global_prompt: prompt.endsWith("\n") ? prompt : `${prompt}\n`,
      nodes,
      start_node_id,
      start_speaker: "agent",
      tools,
      model_choice: {
        type: "cascading",
        model,
        high_priority: false,
        ultrafast: false,
      },
      tool_call_strict_mode: true,
      knowledge_base_ids: [],
      kb_config: {
        filter_score: 0.6,
        top_k: 3,
      },
      begin_tag_display_position: { x: 6, y: 15 },
      notes: [],
      is_published: false,
      is_transfer_cf: false,
    },
  };

  return {
    importDoc,
    conversationFlow: importDoc.conversationFlow,
    cfg,
    fns,
    now,
  };
}

export function main() {
  const { importDoc, conversationFlow } = buildConversationFlowDoc(retellDir);
  writeFileSync(outPath, JSON.stringify(importDoc, null, 2) + "\n", "utf8");
  const fnNodes = conversationFlow.nodes.filter((n) => n.type === "function");
  console.log(`Wrote ${outPath}`);
  console.log(
    `Function nodes: ${fnNodes.map((n) => n.name).join(", ")}`,
  );
  console.log(
    "Path: Welcome → Check Availability → Discuss → Book → Confirm → End",
  );
  console.log(
    "Path: Welcome → Collect cancel → Cancel → Confirm cancel → (Transfer / End)",
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main();
}
