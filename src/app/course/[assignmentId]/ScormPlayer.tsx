"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    API?: unknown; // SCORM 1.2
    API_1484_11?: unknown; // SCORM 2004
  }
}

export function ScormPlayer({
  assignmentId,
  contentUrl,
  version,
  initialCmi,
}: {
  assignmentId: string;
  contentUrl: string;
  version: "SCORM_12" | "SCORM_2004";
  initialCmi?: Record<string, unknown>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let api: { on: (e: string, cb: (d: unknown) => void) => void } | null = null;
    let cancelled = false;

    (async () => {
      const mod: any = await import("scorm-again");
      if (cancelled) return;
      const Impl = version === "SCORM_2004" ? mod.Scorm2004API : mod.Scorm12API;
      api = new Impl({
        autocommit: true,
        autocommitSeconds: 30,
        logLevel: 4,
      });
      if (initialCmi) (api as any).loadFromJSON(initialCmi);
      if (version === "SCORM_2004") window.API_1484_11 = api;
      else window.API = api;

      const persist = async () => {
        const cmi = (api as any).renderCommitCMI(true);
        await fetch(`/api/scorm/${assignmentId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmi }),
        });
      };
      (api as any).on("LMSCommit", persist);
      (api as any).on("CommitSuccess", persist);
      (api as any).on("LMSFinish", async () => {
        await fetch(`/api/scorm/${assignmentId}/complete`, { method: "POST" });
        window.location.href = `/exam/${assignmentId}`;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [assignmentId, version, initialCmi]);

  return (
    <iframe
      ref={iframeRef}
      src={contentUrl}
      className="w-full h-[calc(100vh-8rem)] border rounded-xl bg-white"
      allow="fullscreen"
    />
  );
}
