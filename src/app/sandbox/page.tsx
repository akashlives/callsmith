import { redirect } from "next/navigation";

import { HOLD_SANDBOX_PATH } from "@/lib/canonical-contract";

export default function SandboxIndexPage() {
  redirect(HOLD_SANDBOX_PATH);
}
