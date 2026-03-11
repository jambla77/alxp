import type { ProtocolMessage, MessagePayload } from "../types/index.js";

/** Handler for a specific message type */
export type MessageHandler<T extends MessagePayload = MessagePayload> = (
  message: ProtocolMessage & { payload: T },
) => Promise<void>;

/** Registry of message handlers */
export class MessageRouter {
  private handlers = new Map<string, MessageHandler[]>();

  /** Register a handler for a message type */
  on<T extends MessagePayload>(
    type: T["type"],
    handler: MessageHandler<T>,
  ): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as MessageHandler);
    this.handlers.set(type, existing);
  }

  /** Route a message to registered handlers */
  async route(message: ProtocolMessage): Promise<void> {
    const handlers = this.handlers.get(message.payload.type) ?? [];
    for (const handler of handlers) {
      await handler(message);
    }
  }

  /** Check if any handlers exist for a message type */
  hasHandler(type: string): boolean {
    return (this.handlers.get(type)?.length ?? 0) > 0;
  }
}
