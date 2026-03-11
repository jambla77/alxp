import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentDescription } from "../types/agent.js";
import { TaskSpec } from "../types/task.js";
import { Offer } from "../types/offer.js";
import { TaskContract } from "../types/contract.js";
import { ContextEnvelope } from "../types/context.js";
import { ResultBundle } from "../types/result.js";
import { WorkReceipt } from "../types/receipt.js";
import { DisputeRecord } from "../types/dispute.js";
import { ProtocolMessage } from "../types/message.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "..", "..", "schemas");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema expects Zod v3 types
const schemas: { name: string; schema: any }[] = [
  { name: "agent-description", schema: AgentDescription },
  { name: "task-spec", schema: TaskSpec },
  { name: "offer", schema: Offer },
  { name: "task-contract", schema: TaskContract },
  { name: "context-envelope", schema: ContextEnvelope },
  { name: "result-bundle", schema: ResultBundle },
  { name: "work-receipt", schema: WorkReceipt },
  { name: "dispute-record", schema: DisputeRecord },
  { name: "protocol-message", schema: ProtocolMessage },
];

mkdirSync(outDir, { recursive: true });

for (const { name, schema } of schemas) {
  const jsonSchema = zodToJsonSchema(schema, { name, $refStrategy: "none" });
  const filePath = join(outDir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`Generated ${filePath}`);
}

console.log(`\nDone. ${schemas.length} schemas written to ${outDir}`);
