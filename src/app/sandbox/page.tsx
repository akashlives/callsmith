import { redirect } from "next/navigation";

import { listSuites } from "@/lib/suites";

export default function SandboxIndexPage() {
  const suite = listSuites()[0];
  const scenario = suite?.scenarios.at(-1);
  if (!suite || !scenario) redirect("/");
  redirect(`/sandbox/${suite.id}/${scenario.id}`);
}
