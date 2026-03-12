import type { ProtocolMessage, MessagePayload } from "../types/index.js";
import { createMessage } from "../messages/envelope.js";
import type { DID } from "../types/index.js";

/** Payload type to JSON-RPC method mapping */
const TYPE_TO_METHOD: Record<MessagePayload["type"], string> = {
  // Core lifecycle
  ANNOUNCE_TASK: "alxp.announceTask",
  BID: "alxp.bid",
  AWARD: "alxp.award",
  SUBMIT_RESULT: "alxp.submitResult",
  VERIFY: "alxp.verify",
  SETTLE: "alxp.settle",
  CHALLENGE_RESULT: "alxp.challengeResult",
  VALIDATOR_ASSESS: "alxp.validatorAssess",
  // Exchange
  HEARTBEAT: "alxp.heartbeat",
  METERING_UPDATE: "alxp.meteringUpdate",
  // Compensation
  COMP_ALLOCATE: "alxp.compAllocate",
  COMP_VEST: "alxp.compVest",
  COMP_FORFEIT: "alxp.compForfeit",
  COMP_USAGE_REPORT: "alxp.compUsageReport",
  // Employer
  BUDGET_CREATE: "alxp.budgetCreate",
  BUDGET_ALLOCATE: "alxp.budgetAllocate",
  BUDGET_WARNING: "alxp.budgetWarning",
  ORG_USAGE_REPORT: "alxp.orgUsageReport",
  // SLA
  SLA_DECLARE: "alxp.slaDeclare",
  SLA_REPORT: "alxp.slaReport",
  // Accounting
  VALUATION_RECORD: "alxp.valuationRecord",
  TAX_EVENT: "alxp.taxEvent",
  REPORT_GENERATED: "alxp.reportGenerated",
};

/** JSON-RPC response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: { status: string; messageId: string };
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

/** ALXP HTTP Client — sends signed messages to remote agents */
export class ALXPClient {
  private rpcId = 0;

  constructor(
    private readonly senderDid: DID,
    private readonly privateKey: Uint8Array,
  ) {}

  /** Send a signed message to a remote agent */
  async send(
    endpoint: string,
    payload: MessagePayload,
    options?: { recipient?: DID; replyTo?: string; headers?: Record<string, string> },
  ): Promise<JsonRpcResponse> {
    const message = createMessage({
      sender: this.senderDid,
      privateKey: this.privateKey,
      payload,
      recipient: options?.recipient,
      replyTo: options?.replyTo,
      headers: options?.headers,
    });

    return this.sendRaw(endpoint, message);
  }

  /** Send a pre-constructed ProtocolMessage */
  async sendRaw(endpoint: string, message: ProtocolMessage): Promise<JsonRpcResponse> {
    const method = TYPE_TO_METHOD[message.payload.type];
    if (!method) {
      throw new Error(`Unknown payload type: ${message.payload.type}`);
    }

    const rpcRequest = {
      jsonrpc: "2.0" as const,
      method,
      params: message,
      id: ++this.rpcId,
    };

    const response = await fetch(`${endpoint}/alxp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcRequest),
    });

    return (await response.json()) as JsonRpcResponse;
  }
}
