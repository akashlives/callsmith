import {
  MAX_DRAFT_BYTES,
  suiteRepository,
} from "@/lib/suite-repository";
import { getSuite } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../_lib/http";
import {
  SuiteAuthoringError,
  compileDraftEnvelope,
} from "../_lib/suite-authoring";
import { suiteRepositoryError } from "../_lib/suite-capabilities";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const submission = compileDraftEnvelope(await readJsonBody(request));
    if (
      Buffer.byteLength(JSON.stringify(submission.candidate), "utf8") >
      MAX_DRAFT_BYTES
    ) {
      return jsonError(422, "Suite draft is invalid");
    }
    if (getSuite(submission.candidate.id)) {
      return jsonError(409, "Suite id is reserved");
    }

    const created = await suiteRepository.createDraft(submission.storedDraft);
    const challenge = await suiteRepository.requestApproval(
      created.draft.id,
      created.ownerToken,
      submission.candidate,
    );

    return Response.json(
      {
        draft: challenge.draft,
        source: submission.source,
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
    if (error instanceof SuiteAuthoringError) {
      return jsonError(422, "Suite draft is invalid", error.issues);
    }
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return jsonError(400, messageFromUnknown(error));
    }
    return suiteRepositoryError(error);
  }
}
