import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  APPLIANCE_OPS_TOOLS,
  CheckTechAvailabilityInputSchema,
  LookupJobInputSchema,
  BookAppointmentInputSchema,
  ReschedulePartsInstallInputSchema,
  CancelAppointmentInputSchema,
  TransferToDispatcherInputSchema,
} from "../src/tools.js";
import {
  CANCELLATION_POLICY,
  SUPPORTED_SKILLS,
  UNSUPPORTED_SERVICES,
} from "../src/policies.js";
import {
  BenchmarkRunIngestSchema,
  BenchmarkTurnMetricSchema,
  ARCHITECTURE_COST_RATES,
} from "../src/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMAS_DIR = path.resolve(__dirname, "../schemas");

if (!fs.existsSync(SCHEMAS_DIR)) {
  fs.mkdirSync(SCHEMAS_DIR, { recursive: true });
}

// 1. Export individual tool JSON schemas
const toolSchemas = [
  { name: "check_tech_availability", schema: CheckTechAvailabilityInputSchema },
  { name: "lookup_job", schema: LookupJobInputSchema },
  { name: "book_appointment", schema: BookAppointmentInputSchema },
  { name: "reschedule_parts_install", schema: ReschedulePartsInstallInputSchema },
  { name: "cancel_appointment", schema: CancelAppointmentInputSchema },
  { name: "transfer_to_dispatcher", schema: TransferToDispatcherInputSchema },
];

for (const { name, schema } of toolSchemas) {
  const jsonSchema = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  const filePath = path.join(SCHEMAS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`Generated: ${filePath}`);
}

// 2. Export combined tool manifest in OpenAI / Retell format
const combinedManifest = {
  version: "1.0.0",
  tools: APPLIANCE_OPS_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }),
    },
  })),
};

const manifestPath = path.join(SCHEMAS_DIR, "applianceops-tools.json");
fs.writeFileSync(manifestPath, JSON.stringify(combinedManifest, null, 2) + "\n");
console.log(`Generated: ${manifestPath}`);

// 3. Export domain policies
const policiesPayload = {
  cancellation_policy: CANCELLATION_POLICY,
  supported_skills: SUPPORTED_SKILLS,
  unsupported_services: UNSUPPORTED_SERVICES,
};

const policiesPath = path.join(SCHEMAS_DIR, "domain-policies.json");
fs.writeFileSync(policiesPath, JSON.stringify(policiesPayload, null, 2) + "\n");
console.log(`Generated: ${policiesPath}`);

// 4. Export benchmark telemetry schemas
const telemetrySchemas = [
  { name: "benchmark_turn_metric", schema: BenchmarkTurnMetricSchema },
  { name: "benchmark_run_ingest", schema: BenchmarkRunIngestSchema },
];

for (const { name, schema } of telemetrySchemas) {
  const jsonSchema = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  const filePath = path.join(SCHEMAS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`Generated: ${filePath}`);
}

const costRatesPath = path.join(SCHEMAS_DIR, "architecture-cost-rates.json");
fs.writeFileSync(costRatesPath, JSON.stringify(ARCHITECTURE_COST_RATES, null, 2) + "\n");
console.log(`Generated: ${costRatesPath}`);

console.log("All schemas successfully exported!");
