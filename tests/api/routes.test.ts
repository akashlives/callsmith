import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as browserResult } from "@/app/api/internal/browser-results/route";
import { GET as getEvents } from "@/app/api/runs/[id]/events/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { POST as shareRun } from "@/app/api/runs/[id]/share/route";
import { POST as createRun } from "@/app/api/runs/route";
import { POST as validateSuite } from "@/app/api/suites/validate/route";
import { POST as importSuite } from "@/app/api/suites/route";
import {
  createPreviewAttempt,
  createProviderFailureAttempt,
} from "@/lib/evaluation";
import { runStore } from "@/lib/run-store";
import {
  SALES_GAUNTLET_SUITE,
  SUPPORT_ESCALATION_SUITE,
  suiteForContract,
} from "@/lib/suites";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Callsmith API routes", () => {
  beforeEach(() => runStore.clear());

  it("validates safe suite JSON and rejects executable additions", async () => {
    const valid = await validateSuite(
      jsonRequest("http://callsmith.test/api/suites/validate", SALES_GAUNTLET_SUITE),
    );
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ valid: true });

    const unsafe = structuredClone(SALES_GAUNTLET_SUITE) as unknown as Record<
      string,
      unknown
    >;
    const tools = unsafe.tools as Array<Record<string, unknown>>;
    tools[0] = { ...tools[0], execute: "alert('no')" };
    const rejected = await validateSuite(
      jsonRequest("http://callsmith.test/api/suites/validate", unsafe),
    );
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: "Suite definition is invalid",
    });
  });

  it("creates an explicitly labeled preview, reads it, streams it, and shares it", async () => {
    const response = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: SALES_GAUNTLET_SUITE.id,
        scenarioId: "injection-confirmation",
        models: ["preview"],
        repetitions: 1,
        seed: 606,
        provenance: "preview",
        contractVariants: ["weak", "hardened"],
        // Evidence state is server-derived. A client cannot pre-claim proof.
        evidenceStatus: "provider_failure",
      }),
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as {
      id: string;
      provenance: string;
      evidenceStatus: string;
    };
    expect(created.provenance).toBe("deterministic_preview");
    expect(created.evidenceStatus).toBe("pending");

    await vi.waitFor(() => {
      expect(runStore.get(created.id)?.status).toBe("completed");
      expect(runStore.get(created.id)?.evidenceStatus).toBe("conclusive");
    });

    const read = await getRun(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(read.status).toBe(200);
    const run = await read.json();
    expect(run).toMatchObject({
      id: created.id,
      status: "completed",
      provenance: "deterministic_preview",
      evidenceStatus: "conclusive",
    });
    expect(run.attempts).toHaveLength(2);
    expect(run.attempts[0]).toMatchObject({
      provenance: "deterministic_preview",
    });

    const events = await getEvents(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const terminalEvent = await events.text();
    expect(terminalEvent).toContain(`"id":"${created.id}"`);
    expect(terminalEvent).toContain('"evidenceStatus":"conclusive"');

    const shared = await shareRun(
      new Request(`http://callsmith.test/api/runs/${created.id}/share`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(shared.status).toBe(201);
    const report = (await shared.json()) as {
      token: string;
      url: string;
      readOnly: boolean;
      evidenceStatus: string;
    };
    expect(report.token.length).toBeGreaterThan(48);
    expect(report.url).toBe(`http://callsmith.test/r/${report.token}`);
    expect(report.readOnly).toBe(true);
    expect(report.evidenceStatus).toBe("conclusive");
    expect(runStore.getByShareToken(report.token)?.id).toBe(created.id);

    const previousPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://callsmith.example/";
    try {
      const publicShare = await shareRun(
        new Request(`http://0.0.0.0:8080/api/runs/${created.id}/share`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const publicReport = (await publicShare.json()) as { token: string; url: string };
      expect(publicReport.url).toBe(
        `https://callsmith.example/r/${publicReport.token}`,
      );
    } finally {
      if (previousPublicUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousPublicUrl;
    }
  });

  it("propagates pending evidence through read, SSE, runner start, and share responses", async () => {
    const run = runStore.create({
      suiteId: SALES_GAUNTLET_SUITE.id,
      suiteVersion: SALES_GAUNTLET_SUITE.version,
      scenarioId: "happy-path",
      models: ["gpt-5.6-luna"],
      repetitions: 1,
      seed: 101,
      provenance: "browser_webmcp",
      contractVariants: ["weak", "hardened"],
    });
    expect(run.evidenceStatus).toBe("pending");

    const read = await getRun(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: run.id }),
    });
    await expect(read.json()).resolves.toMatchObject({
      status: "queued",
      evidenceStatus: "pending",
    });

    const controller = new AbortController();
    const events = await getEvents(
      new Request("http://callsmith.test", { signal: controller.signal }),
      { params: Promise.resolve({ id: run.id }) },
    );
    const reader = events.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain(
      '"evidenceStatus":"pending"',
    );
    controller.abort();
    await reader?.cancel();

    const previousToken = process.env.CALLSMITH_RUNNER_TOKEN;
    process.env.CALLSMITH_RUNNER_TOKEN = "runner-test-token";
    try {
      const started = await browserResult(
        new Request("http://callsmith.test/api/internal/browser-results", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runner-test-token",
          },
          body: JSON.stringify({ type: "started", runId: run.id }),
        }),
      );
      await expect(started.json()).resolves.toMatchObject({
        status: "running",
        evidenceStatus: "pending",
      });
    } finally {
      if (previousToken === undefined) delete process.env.CALLSMITH_RUNNER_TOKEN;
      else process.env.CALLSMITH_RUNNER_TOKEN = previousToken;
    }

    const shared = await shareRun(
      new Request(`http://callsmith.test/api/runs/${run.id}/share`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    await expect(shared.json()).resolves.toMatchObject({
      readOnly: true,
      status: "running",
      evidenceStatus: "pending",
    });
  });

  it("derives partial terminal evidence as inconclusive in runner callbacks", async () => {
    const run = runStore.create({
      suiteId: SALES_GAUNTLET_SUITE.id,
      suiteVersion: SALES_GAUNTLET_SUITE.version,
      scenarioId: "happy-path",
      models: ["gpt-5.6-luna"],
      repetitions: 1,
      seed: 101,
      provenance: "browser_webmcp",
      contractVariants: ["weak", "hardened"],
    });
    const weakSuite = suiteForContract(SALES_GAUNTLET_SUITE, "weak");
    const hardenedSuite = suiteForContract(SALES_GAUNTLET_SUITE, "hardened");
    const weakScenario = weakSuite.scenarios.find(
      (scenario) => scenario.id === "happy-path",
    );
    const hardenedScenario = hardenedSuite.scenarios.find(
      (scenario) => scenario.id === "happy-path",
    );
    expect(weakScenario).toBeDefined();
    expect(hardenedScenario).toBeDefined();
    if (!weakScenario || !hardenedScenario) throw new Error("Missing test scenario");

    runStore.appendAttempt(
      run.id,
      createPreviewAttempt(
        weakSuite,
        weakScenario,
        "success",
        "gpt-5.6-luna",
        101,
        "weak",
      ),
    );
    runStore.appendAttempt(
      run.id,
      createProviderFailureAttempt(
        hardenedSuite,
        hardenedScenario,
        "gpt-5.6-luna",
        101,
        "Browser process exited before producing evidence.",
        14,
        { provenance: "browser_webmcp", contractVariant: "hardened" },
      ),
    );
    expect(runStore.get(run.id)?.evidenceStatus).toBe("pending");

    const previousToken = process.env.CALLSMITH_RUNNER_TOKEN;
    process.env.CALLSMITH_RUNNER_TOKEN = "runner-test-token";
    try {
      const completed = await browserResult(
        new Request("http://callsmith.test/api/internal/browser-results", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runner-test-token",
          },
          body: JSON.stringify({
            type: "completed",
            runId: run.id,
            // Strict callback schemas reject attempts to dictate proof state.
            evidenceStatus: "conclusive",
          }),
        }),
      );
      expect(completed.status).toBe(400);

      const accepted = await browserResult(
        new Request("http://callsmith.test/api/internal/browser-results", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runner-test-token",
          },
          body: JSON.stringify({ type: "completed", runId: run.id }),
        }),
      );
      await expect(accepted.json()).resolves.toMatchObject({
        status: "partial_failure",
        evidenceStatus: "inconclusive",
      });
    } finally {
      if (previousToken === undefined) delete process.env.CALLSMITH_RUNNER_TOKEN;
      else process.env.CALLSMITH_RUNNER_TOKEN = previousToken;
    }

    const read = await getRun(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: run.id }),
    });
    await expect(read.json()).resolves.toMatchObject({
      status: "partial_failure",
      evidenceStatus: "inconclusive",
    });
  });

  it("returns provider_failure only when no completed evidence exists", async () => {
    const response = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: SALES_GAUNTLET_SUITE.id,
        scenarioId: "happy-path",
        models: ["preview"],
        repetitions: 1,
        seed: 101,
        provenance: "server_simulation",
        contractVariants: ["hardened"],
        apiKey: "request-scoped-test-key",
        evidenceStatus: "conclusive",
      }),
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as {
      id: string;
      evidenceStatus: string;
    };
    expect(created.evidenceStatus).toBe("pending");

    await vi.waitFor(() => {
      expect(runStore.get(created.id)).toMatchObject({
        status: "failed",
        evidenceStatus: "provider_failure",
      });
    });

    const read = await getRun(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: created.id }),
    });
    await expect(read.json()).resolves.toMatchObject({
      status: "failed",
      evidenceStatus: "provider_failure",
      attempts: [{ status: "provider_failure" }],
    });
  });

  it("returns actionable errors for unknown and unconfigured model runs", async () => {
    const missing = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: "missing-suite",
        scenarioId: "missing-scenario",
      }),
    );
    expect(missing.status).toBe(404);

    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const unavailable = await createRun(
        jsonRequest("http://callsmith.test/api/runs", {
          suiteId: SALES_GAUNTLET_SUITE.id,
          scenarioId: "happy-path",
          provenance: "model",
        }),
      );
      expect(unavailable.status).toBe(503);
      await expect(unavailable.json()).resolves.toMatchObject({
        error: "Model runner is not configured",
        details: { code: "MODEL_KEY_REQUIRED", previewAvailable: true },
      });
    } finally {
      if (previousKey) process.env.OPENAI_API_KEY = previousKey;
    }
  });

  it("imports, runs, and shares a safe JSON suite without application code", async () => {
    const importedDefinition = structuredClone(SUPPORT_ESCALATION_SUITE);
    importedDefinition.id = "community-support-escalation";
    importedDefinition.title = "Community Support Escalation";
    const imported = await importSuite(
      jsonRequest("http://callsmith.test/api/suites", importedDefinition),
    );
    expect(imported.status).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      imported: true,
      suite: { id: "community-support-escalation", version: "1.0.0" },
    });

    const response = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: "community-support-escalation",
        scenarioId: "hostile-ticket-note",
        models: ["preview"],
        repetitions: 1,
        seed: 707,
        provenance: "deterministic_preview",
        contractVariants: ["hardened"],
      }),
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as { id: string };
    await vi.waitFor(() => {
      expect(runStore.get(created.id)?.status).toBe("completed");
    });
    expect(runStore.get(created.id)?.attempts[0]).toMatchObject({
      suiteId: "community-support-escalation",
      taskCompleted: true,
      safetyOutcome: "safe",
    });

    const shared = await shareRun(
      new Request(`http://callsmith.test/api/runs/${created.id}/share`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(shared.status).toBe(201);
  });
});
