import { describe, it, expect, afterAll } from "vitest";
import { WebhookPublisher, WebhookReceiver, ProgressStream } from "../src/transport/webhook.js";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import type { WebhookNotification } from "../src/transport/webhook.js";

describe("WebhookPublisher + WebhookReceiver", () => {
  const PORT = 9730;
  let receiver: WebhookReceiver;

  afterAll(async () => {
    await receiver?.close();
  });

  it("publishes notifications to registered callbacks", async () => {
    receiver = new WebhookReceiver();
    const receivedNotifications: WebhookNotification[] = [];

    receiver.onNotification(async (n) => {
      receivedNotifications.push(n);
    });

    await receiver.listen(PORT);

    const publisher = new WebhookPublisher();
    const contractId = "test-contract-01";

    publisher.register(contractId, `http://localhost:${PORT}/webhook`);

    const sender = generateAgentIdentity();
    const notification: WebhookNotification = {
      type: "state_change",
      contractId,
      taskId: "test-task-01",
      data: {
        state: "RUNNING",
        previousState: "AWARDED",
        message: "Worker has started processing",
      },
      timestamp: new Date().toISOString(),
      sender: sender.did,
      signature: signString("test-notification", sender.keyPair.privateKey),
    };

    const sent = await publisher.notify(notification);
    expect(sent).toBe(1);

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedNotifications).toHaveLength(1);
    expect(receivedNotifications[0]!.type).toBe("state_change");
    expect(receivedNotifications[0]!.data.state).toBe("RUNNING");
  });

  it("filters notifications by event type", async () => {
    const publisher = new WebhookPublisher();
    const contractId = "test-contract-02";

    // Only subscribe to progress events
    publisher.register(contractId, `http://localhost:${PORT}/webhook`, ["progress"]);

    const sender = generateAgentIdentity();

    // Send a state_change (should be filtered out)
    const stateChange: WebhookNotification = {
      type: "state_change",
      contractId,
      taskId: "test-task-02",
      data: { state: "RUNNING" },
      timestamp: new Date().toISOString(),
      sender: sender.did,
      signature: signString("n1", sender.keyPair.privateKey),
    };

    const sent1 = await publisher.notify(stateChange);
    expect(sent1).toBe(0); // Filtered out

    // Send a progress event (should be delivered)
    const progress: WebhookNotification = {
      type: "progress",
      contractId,
      taskId: "test-task-02",
      data: { progress: 50, message: "Halfway done" },
      timestamp: new Date().toISOString(),
      sender: sender.did,
      signature: signString("n2", sender.keyPair.privateKey),
    };

    const sent2 = await publisher.notify(progress);
    expect(sent2).toBe(1);
  });

  it("manages registrations", () => {
    const publisher = new WebhookPublisher();
    const contractId = "test-contract-03";

    publisher.register(contractId, "http://callback1.example.com/webhook");
    publisher.register(contractId, "http://callback2.example.com/webhook");

    expect(publisher.getRegistrations(contractId)).toHaveLength(2);

    publisher.unregister(contractId);
    expect(publisher.getRegistrations(contractId)).toHaveLength(0);
  });
});

describe("ProgressStream (SSE)", () => {
  it("emits and receives progress events", () => {
    const stream = new ProgressStream();
    const received: { event: string; data: string }[] = [];

    const contractId = "test-sse-01";
    const unsub = stream.subscribe(contractId, (event, data) => {
      received.push({ event, data });
    });

    stream.progress(contractId, 25, "Quarter done");
    stream.progress(contractId, 50, "Half done");
    stream.heartbeat(contractId);
    stream.progress(contractId, 100, "Complete");
    stream.complete(contractId);

    expect(received).toHaveLength(5);
    expect(received[0]!.event).toBe("progress");
    expect(JSON.parse(received[0]!.data).percent).toBe(25);
    expect(received[2]!.event).toBe("heartbeat");
    expect(received[4]!.event).toBe("complete");

    unsub(); // Unsubscribe

    stream.progress(contractId, 200, "Should not be received");
    expect(received).toHaveLength(5); // No new events
  });

  it("supports multiple subscribers", () => {
    const stream = new ProgressStream();
    const contractId = "test-sse-02";
    let count1 = 0;
    let count2 = 0;

    stream.subscribe(contractId, () => { count1++; });
    stream.subscribe(contractId, () => { count2++; });

    stream.progress(contractId, 50);

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("isolates events by contract", () => {
    const stream = new ProgressStream();
    let received = 0;

    stream.subscribe("contract-A", () => { received++; });

    stream.progress("contract-B", 50); // Different contract
    expect(received).toBe(0);

    stream.progress("contract-A", 50); // Correct contract
    expect(received).toBe(1);
  });

  it("emits error events", () => {
    const stream = new ProgressStream();
    const contractId = "test-sse-03";
    let errorData = "";

    stream.subscribe(contractId, (event, data) => {
      if (event === "error") errorData = data;
    });

    stream.error(contractId, "Worker ran out of context window");

    expect(errorData).toBeTruthy();
    expect(JSON.parse(errorData).error).toBe("Worker ran out of context window");
  });
});
