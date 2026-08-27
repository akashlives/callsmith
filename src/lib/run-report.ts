import { runStore } from "@/lib/run-store";

export type SharedRunReport = {
  token: string;
  path: string;
  url: string;
  readOnly: true;
  status: "queued" | "running" | "completed" | "partial_failure" | "failed";
  evidenceStatus: "pending" | "conclusive" | "inconclusive" | "provider_failure";
};

function publicOrigin(requestUrl: string): string {
  const configuredOrigin =
    process.env.CALLSMITH_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : undefined);
  return configuredOrigin?.replace(/\/$/, "") || requestUrl;
}

/** Create or reuse the one opaque, read-only report capability for a run. */
export async function ensureSharedRunReport(
  id: string,
  requestUrl: string,
): Promise<SharedRunReport | undefined> {
  const run = await runStore.getPersistent(id);
  if (!run) return undefined;

  const token = await runStore.sharePersistent(id);
  const sharedRun = (await runStore.getPersistent(id)) ?? run;
  const path = `/r/${token}`;
  return {
    token,
    path,
    url: new URL(path, publicOrigin(requestUrl)).toString(),
    readOnly: true,
    status: sharedRun.status,
    evidenceStatus: sharedRun.evidenceStatus,
  };
}
