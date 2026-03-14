import { useState } from "react";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import PageRenderer from "./components/layout/PageRenderer";
import SplashScreen from "./components/layout/SplashScreen";
import "./styles/global.css";

export default function App() {
  const [activePage, setActivePage]   = useState("add-devices");
  const [showSplash, setShowSplash]   = useState(true);
  const [appVisible, setAppVisible]   = useState(false);

  const handleSplashDone = () => {
    setShowSplash(false);
    setTimeout(() => setAppVisible(true), 50);
  };

  return (
    <>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <div className="app-root" style={{ opacity: appVisible ? 1 : 0, transition: "opacity 0.5s ease" }}>
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <div className="app-main-area">
          <TopBar activePage={activePage} />
          <main className="app-content">
            <PageRenderer activePage={activePage} />
          </main>
        </div>
      </div>
    </>
  );
}