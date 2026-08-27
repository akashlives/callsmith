import {
  MAX_DRAFT_BYTES,
  suiteRepository,
} from "@/lib/suite-repository";
import { getSuite, validateSuite } from "@/lib/suites";

import { jsonError, readJsonBody } from "../_lib/http";
import { suiteRepositoryError } from "../_lib/suite-capabilities";

export const dynamic = "force-dynamic";

function suiteInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return (input as Record<string, unknown>).suite;
}

export async function POST(request: Request) {
  try {
    const candidate = suiteInput(await readJsonBody(request));
    const validation = validateSuite(candidate);
    if (!validation.success) return jsonError(422, "Suite draft is invalid");
    if (
      Buffer.byteLength(JSON.stringify(validation.data), "utf8") >
      MAX_DRAFT_BYTES
    ) {
      return jsonError(422, "Suite draft is invalid");
    }
    if (getSuite(validation.data.id)) {
      return jsonError(409, "Suite id is reserved");
    }

    const created = await suiteRepository.createDraft({
      kind: "suite_definition",
      suiteId: validation.data.id,
      suiteVersion: validation.data.version,
      title: validation.data.title,
    });
    const challenge = await suiteRepository.requestApproval(
      created.draft.id,
      created.ownerToken,
      validation.data,
    );

    return Response.json(
      {
        draft: challenge.draft,
        ownerToken: created.ownerToken,
        confirmationToken: challenge.confirmationToken,
        confirmationExpiresAt: challenge.expiresAt,
        links: {
          self: `/api/suite-drafts/${created.draft.id}`,
          approveAndRun: `/api/suite-drafts/${created.draft.id}/approve-and-run`,
        },
      },
      {
        status: 201,
        headers: { "cache-control": "no-store, private" },
      },
    );
  } catch (error) {
    return suiteRepositoryError(error);
  }
}
