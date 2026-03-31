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
  const { isAuthenticated, isLoading } = useAuth();
  const [activePage, setActivePage] = useState("add-devices");
  const [showSplash, setShowSplash] = useState(true);
  const [appVisible, setAppVisible] = useState(false);
  const [alarmsOpen, setAlarmsOpen] = useState(false);

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
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <div className="app-main-area">
          <TopBar
            activePage={activePage}
            onNavigate={setActivePage}
            onAlarmsClick={() => setAlarmsOpen((p) => !p)}
            alarmsOpen={alarmsOpen}
          />
          <main className="app-content">
            <PageRenderer activePage={activePage} />
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
