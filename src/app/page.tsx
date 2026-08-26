import CallsmithWorkbench from "@/components/callsmith-workbench";
import { previewWorkbenchData } from "@/components/preview-data";
import WebMcpBridge from "@/components/webmcp-bridge";

export default function Home() {
  return (
    <>
      <WebMcpBridge />
      <CallsmithWorkbench data={previewWorkbenchData} provenance="preview" />
    </>
  );
}
