import { MoeApp } from './v2/MoeApp';

// The v2 two-tab app (Model Architecture explorer + Domain Specialization) is the whole page.
// The old pinned-strip experience was removed 2026-07-21 (recoverable at git tag
// pre-strip-removal); RouterDiagram is its sole survivor, reused by the v2 arch tab.
function App() {
  return <MoeApp />;
}

export default App;
