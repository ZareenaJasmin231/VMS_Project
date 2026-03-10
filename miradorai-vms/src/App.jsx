import { useState } from "react";
import Sidebar   from "./components/layout/Sidebar";
import TopBar    from "./components/layout/TopBar";
import PageRenderer from "./components/layout/PageRenderer";
import "./styles/global.css";

export default function App() {
  const [activePage, setActivePage] = useState("add-devices");

  return (
    <div className="app-root">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="app-main-area">
        <TopBar activePage={activePage} />
        <main className="app-content">
          <PageRenderer activePage={activePage} />
        </main>
      </div>
    </div>
  );
}
