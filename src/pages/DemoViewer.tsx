export default function DemoViewer() {
  return <main style={{ paddingTop: 88, minHeight: "100vh" }}>
    <iframe src="/demo-viewer/?embed=1" title="Quake Live Demo Viewer" allow="fullscreen" allowFullScreen
      style={{ display: "block", border: 0, width: "100%", height: "calc(100vh - 88px)", minHeight: 640 }} />
  </main>;
}
