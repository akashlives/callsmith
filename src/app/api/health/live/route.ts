export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "alive", service: "callsmith-web" },
    { headers: { "cache-control": "no-store" } },
  );
}

