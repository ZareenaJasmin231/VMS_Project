import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import PageRenderer from "./components/layout/PageRenderer";
import SplashScreen from "./components/layout/SplashScreen";
import AlarmsPanel from "./components/layout/AlarmsPanel";
import LoginPage from "./pages/auth/LoginPage";
import "./styles/global.css";

function AppContent() {
  const { isAuthenticated, isLoading, userRole } = useAuth();
  const [activePage, setActivePage] = useState("add-devices");
  const [history, setHistory] = useState(["add-devices"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [appVisible, setAppVisible] = useState(false);
  const [alarmsOpen, setAlarmsOpen] = useState(false);

  const handleNavigate = (page) => {
    if (page === activePage) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(page);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setActivePage(page);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setActivePage(history[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setActivePage(history[newIndex]);
    }
  };

  const handleSplashDone = () => {
    setShowSplash(false);
    setTimeout(() => setAppVisible(true), 50);
  };

  if (isLoading) {
    return <SplashScreen onDone={() => {}} />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <div
        className="app-root"
        style={{ opacity: appVisible ? 1 : 0, transition: "opacity 0.5s ease" }}
      >
        <Sidebar activePage={activePage} onNavigate={handleNavigate} userRole={userRole} />
        <div className="app-main-area">
          <TopBar
            activePage={activePage}
            onNavigate={handleNavigate}
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex < history.length - 1}
            onBack={goBack}
            onForward={goForward}
            onAlarmsClick={() => setAlarmsOpen((p) => !p)}
            alarmsOpen={alarmsOpen}
          />
          <main className="app-content">
            <PageRenderer activePage={activePage} onNavigate={handleNavigate} userRole={userRole} />
          </main>
          <AlarmsPanel open={alarmsOpen} onClose={() => setAlarmsOpen(false)} />
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}