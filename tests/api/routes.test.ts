import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getEvents } from "@/app/api/runs/[id]/events/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { POST as shareRun } from "@/app/api/runs/[id]/share/route";
import { POST as createRun } from "@/app/api/runs/route";
import { POST as validateSuite } from "@/app/api/suites/validate/route";
import { POST as importSuite } from "@/app/api/suites/route";
import { runStore } from "@/lib/run-store";
import { SALES_GAUNTLET_SUITE, SUPPORT_ESCALATION_SUITE } from "@/lib/suites";

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
        contractVariants: ["hardened"],
      }),
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as { id: string; provenance: string };
    expect(created.provenance).toBe("deterministic_preview");

    await vi.waitFor(() => {
      expect(runStore.get(created.id)?.status).toBe("completed");
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
    });
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({
      provenance: "deterministic_preview",
    });

    const events = await getEvents(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    await expect(events.text()).resolves.toContain(`"id":"${created.id}"`);

    const shared = await shareRun(
      new Request(`http://callsmith.test/api/runs/${created.id}/share`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(shared.status).toBe(201);
    const report = (await shared.json()) as { token: string; url: string; readOnly: boolean };
    expect(report.token.length).toBeGreaterThan(48);
    expect(report.url).toBe(`http://callsmith.test/r/${report.token}`);
    expect(report.readOnly).toBe(true);
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
