/**
 * Create a Retell Web Call session for real browser-based microphone testing.
 *
 * Usage:
 *   npm run retell:webcall
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Retell from "retell-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");

loadEnv({ path: join(repoRoot, ".env") });

const apiKey = process.env.RETELL_API_KEY;
const agentId = process.env.RETELL_AGENT_ID || "agent_5eb84d600795d3d2f65684b721";

if (!apiKey) {
  console.error("Error: RETELL_API_KEY is not set in .env");
  process.exit(1);
}

const client = new Retell({ apiKey });

async function main() {
  console.log(`Creating Retell Web Call session for agent: ${agentId}...`);
  try {
    const webCall = await client.call.createWebCall({
      agent_id: agentId,
      retell_llm_dynamic_variables: {
        customer_name: "Sarah",
        open_job_status: "Parts Install Scheduled",
        assigned_tech: "Mike R.",
        job_id: "1042",
        appliance: "Sub-Zero Refrigerator",
        model_serial: "WRF535SWHZ04",
        parts_status: "in_stock",
        known_caller: "true",
      },
    });

    console.log("\n================================================================================");
    console.log("                  Retell AI Real Web Call Session Created");
    console.log("================================================================================");
    console.log(`Call ID       : ${webCall.call_id}`);
    console.log(`Agent ID      : ${webCall.agent_id}`);
    console.log(`Access Token  : ${webCall.access_token}`);
    console.log("--------------------------------------------------------------------------------");
    console.log("To speak live with your microphone:");
    console.log("1. Open Retell Dashboard: https://dashboard.retellai.com/agents");
    console.log(`2. Select 'ApplianceOps Dispatch' (${agentId})`);
    console.log("3. Click 'Test Call' at the top-right corner to speak in real-time!");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("Failed to create Web Call:", err.message);
    process.exit(1);
  }
}

main();
