export function jsonError(
  status: number,
  error: string,
  details?: unknown,
): Response {
  return Response.json(
    {
      error,
      ...(details === undefined ? {} : { details }),
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new TypeError("Expected an application/json request body");
  }
  return request.json();
}

export function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}
