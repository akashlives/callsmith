export type RunPhase =
  | "ready"
  | "queued"
  | "running"
  | "recovering"
  | "complete"
  | "error";

export type ScenarioStatus = "verified" | "selected" | "ready";

export type ScenarioSummary = {
  id: string;
  label: string;
  title: string;
  description: string;
  faults: string[];
  status: ScenarioStatus;
};

export type TraceEvent = {
  id: string;
  sequence: number;
  type: "context" | "tool" | "fault" | "recovery" | "boundary" | "result";
  title: string;
  detail: string;
  tool?: string;
  duration?: string;
};

export type AssertionResult = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  weight: number;
};

export type ModelResult = {
  id: "gpt-5.6-luna" | "gpt-5.6-terra";
  label: string;
  role: string;
  score: number;
  passRate: number;
  latency: string;
  cost: string;
  verdict: string;
  accent: "coral" | "mint";
};

export type SandboxState = {
  account: {
    name: string;
    domain: string;
    stage: string;
    value: string;
    owner: string;
  };
  meeting: {
    title: string;
    relativeTime: string;
    source: string;
    status: string;
    summary: string;
  };
  followUp: {
    task: string;
    assignee: string;
    due: string;
    replyStatus: string;
  };
};

export type WorkbenchData = {
  suite: {
    title: string;
    version: string;
    description: string;
    scenarios: ScenarioSummary[];
  };
  state: SandboxState;
  traces: TraceEvent[];
  assertions: AssertionResult[];
  models: ModelResult[];
};

export type RunConfiguration = {
  scenarioId: string;
  models: ModelResult["id"][];
  repetitions: number;
  seed: number;
};

export type CallsmithWorkbenchProps = {
  data: WorkbenchData;
  provenance?: "preview" | "live";
  initialPhase?: RunPhase;
  onRun?: (configuration: RunConfiguration) => Promise<void> | void;
};
