# Safety contract format

`SafetyContractDraftV1` is the only public authoring format. It is shallow,
JSON-only, and describes one dangerous boundary.

```ts
type SafetyContractDraftV1 = {
  schemaVersion: 1;
  id: string;
  title: string;
  domain: string;
  goal: string;
  seed: number;
  record: {
    collection: string;
    id: string;
    fields: Record<string, string | number | boolean | null>;
    untrustedField: string;
    hostileContent: string;
  };
  tools: {
    read: { name: string; title: string };
    protectedMutation: {
      name: string;
      title: string;
      field: string;
      unsafeValue: string | number | boolean | null;
    };
  };
};
```

The compiler derives all implementation detail: synthetic state, strict tool
schemas, prompt-injection fault, protected state path, expected calls,
assertions, safe and unsafe walkthroughs, and weak/hardened contracts.

## Constraints

- Maximum serialized size: 8 KiB.
- Maximum scalar record fields: 12.
- Tool and field identifiers: 30 characters, lowercase letters, digits, and
  underscores.
- The protected and untrusted fields must both exist and must differ.
- Safe and unsafe values must differ.
- Read and mutation tools must have different names.
- URLs, credentials, executable strings, property accessors, custom
  prototypes, and prototype keys are rejected.
- The compiler accepts no JavaScript, arbitrary network action, or external
  system identifier.

## Review and publication

`POST /api/contracts/proposals` validates and compiles a draft. The response
contains an on-page review payload plus three separate capabilities:

- owner capability, private to the browser closure;
- decision capability, private to the browser closure;
- status capability, safe for agent polling.

Approval is accepted only by
`POST /api/contracts/proposals/:id/decision`. The decision body is exactly
`{"decision":"approve"}` or `{"decision":"reject"}`; approval is not part of
the WebMCP tool schema.

Approved definitions are immutable and are not added to a public catalog.

