import { useEffect, useRef, useState } from "react";
import { Seo } from "../components/Seo";
import { useLang } from "../hooks/useLang";
import { respawnLab } from "../data/respawnLab";
import { C } from "../theme";

export default function RespawnLab() {
  const { lang } = useLang();
  const t = respawnLab[lang];
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);

  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "respawn-lab:height" && Number.isFinite(event.data.height)) {
        setHeight(Math.max(400, Math.min(10000, event.data.height)));
      }
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);

  return (
    <main style={{ padding: "96px 12px 24px", maxWidth: 1600, margin: "0 auto" }}>
      <Seo path="/skill/respawn-lab" title={t.title} description={t.description} />
      <header style={{ padding: "0 8px 20px" }}>
        <h1 style={{ color: C.heading, fontSize: "clamp(24px, 5vw, 36px)", margin: "0 0 12px" }}>{t.title}</h1>
        <p style={{ color: C.body, lineHeight: 1.7, margin: "0 0 8px" }}>{t.description}</p>
        <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.7 }}>{t.note}</p>
        <a href="/respawn-lab/index.html" target="_blank" rel="noopener noreferrer" style={{ color: "#fbbf24", fontSize: 13 }}>{t.open}</a>
      </header>
      <iframe ref={frame} src="/respawn-lab/index.html" title={t.frameTitle}
        style={{ width: "100%", height, display: "block", border: `1px solid ${C.border}`, borderRadius: 12, background: "#101319" }} />
    </main>
  );
}
