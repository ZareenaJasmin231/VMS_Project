import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import SupervisorModal from "./SupervisorModal";

import AddDevicesPage from "../../pages/devices/AddDevicesPage";
import CamerasPage from "../../pages/devices/CamerasPage";
import OtherDevicesPage from "../../pages/devices/OtherDevicesPage";
import StreamProfilesPage from "../../pages/devices/StreamProfilesPage";
import ImageConfigPage from "../../pages/devices/ImageConfigPage";
import PTZPresetsPage from "../../pages/devices/PTZPresetsPage";
import ManagementPage from "../../pages/devices/ManagementPage";
import ExternalDataPage from "../../pages/devices/ExternalDataPage";
import TimeSyncPage from "../../pages/devices/TimeSyncPage";
import CameraFeaturesPage from "../../pages/devices/CameraFeaturesPage";

import StorageMgmtPage from "../../pages/storage/StorageManagementPage";
import StorageSelPage from "../../pages/storage/StorageSelectionPage";

import RecordingPage from "../../pages/recording/RecordingPage";
import EventsPage from "../../pages/recording/EventsPage";
import TriggersPage from "../../pages/recording/TriggersPage";
import Schedules from "../../pages/recording/Schedules";
import RecordingMethodPage from "../../pages/recording/Recordingmethodpage";
import IOPortsPage from "../../pages/recording/IOPortsPage";
import ActionRulesPage from "../../pages/recording/Actionrulespage";

import ClientSettingsPage from "../../pages/client/ClientSettingsPage";
import UserSettingsPage from "../../pages/client/Usersettingspage";
import UserManagementPage from "../../pages/client/UserManagementPage";
import StreamingPage from "../../pages/client/StreamingPage";
import AboutPage from "../../pages/client/AboutPage";
import ViewingStationsPage from "../../pages/client/ViewingStationsPage";
import EmailSchedulesPage from "../../pages/client/EmailSchedulesPage";

import FirmwareUpgradePage from "../../pages/connectedservices/Firmwareupgradepage";
import SmartSearchSettingsPage from "../../pages/smartsearch/Smartsearchsettingspage";

import LiveViewPage from "../../pages/liveview/LiveViewPage";

import MediaPlayerPage from "../../pages/admin/MediaPlayerPage";
import BackupPage from "../../pages/admin/BackupPage";
import LogsPage from "../../pages/logs/LogsPage";

// ✅ IMPORTANT PAGES
import DashboardPage from "../../pages/Dashboard/DashboardPage";
import MapViewPage from "../../pages/mapview/MapViewPage";
import TopologyPage from "../../pages/infrastructure/Topology";
import NetworkHealthPage from "../../pages/diagnostics/NetworkHealthPage";
import DesignerView from "../../pages/Mapview/DesignerView";
import MaskingPage from "../../pages/devices/MaskingPage";
import ForensicSearchPage from "../../pages/forensic/ForensicSearchPage";
import AiAnalyticsPage from "../../pages/analytics/AiAnalyticsPage";
import SystemPerformancePage from "../../pages/diagnostics/SystemPerformancePage";
import RaidMgmtPage from "../../pages/StorageManagement";

// ✅ REPORTS
import CameraHistoryReport from "../../pages/reports/CameraHistoryReport";
import ReportsPlaceholderPage from "../../pages/reports/ReportsPlaceholderPage";

// const RecordingReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Recording Report" />;
const StorageReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Storage Report" />;
const AnalyticsReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Analytics Report" />;

// ================= PAGE MAP =================
const MAP = {
  // ✅ DASHBOARD (DEFAULT PAGE)
  "dashboard": DashboardPage,
  "ai-analytics": AiAnalyticsPage,

  // ================= DEVICES =================
  "add-devices": AddDevicesPage,
  "cameras": CamerasPage,
  "other-devices": OtherDevicesPage,
  "stream-profiles": StreamProfilesPage,
  "image-config": ImageConfigPage,
  "ptz-presets": PTZPresetsPage,
  "device-mgmt": ManagementPage,
  "ext-data": ExternalDataPage,
  "time-sync": TimeSyncPage,
  "camera-features": CameraFeaturesPage,
  "masking": MaskingPage,

  // ================= STORAGE =================
  "storage-mgmt": StorageMgmtPage,
  "storage-selection": StorageSelPage,

  // ================= RECORDING =================
  "recording": RecordingPage,
  "events": EventsPage,
  "triggers": TriggersPage,
  "schedules": Schedules,
  "rec-method": RecordingMethodPage,
  "io-ports": IOPortsPage,
  "action-rules": ActionRulesPage,

  // ================= CLIENT =================
  "client-settings": ClientSettingsPage,
  "user-settings": UserSettingsPage,
  "user-management": UserManagementPage,
  "streaming": StreamingPage,
  "about": AboutPage,
  "viewing-stations": ViewingStationsPage,
  "email-schedules": EmailSchedulesPage,

  // ================= SERVICES =================
  "firmware-upgrade": FirmwareUpgradePage,
  "smartsearch-settings": SmartSearchSettingsPage,
  "forensic-search": ForensicSearchPage,

  // ================= REPORTS =================
  // "recording-report": RecordingReportPage,
  "recording-report": CameraHistoryReport,

  "storage-report": StorageReportPage,
  "analytics-report": AnalyticsReportPage,



  // ================= LIVE =================
  "live-view": LiveViewPage,

  // ================= ADMIN =================
  "media-player": MediaPlayerPage,
  "backup": BackupPage,
  "logs": LogsPage,
  "map-view": MapViewPage,
  "infrastructure": NetworkHealthPage,
  "topology-map": TopologyPage,
  "designer-view": DesignerView,
  "network-health": NetworkHealthPage,
  "system-performance": SystemPerformancePage,
  "raid-mgmt": RaidMgmtPage,
};

// Pages that require supervisor unlock for CLIENT role
const CLIENT_SUPERVISOR_PAGES = ["backup", "masking"];

// Pages the OPERATOR role is allowed to access
const OPERATOR_ALLOWED_PAGES = ["designer-view"];

// Friendly names for the supervisor modal
const SUPERVISOR_PAGE_NAMES = {
  "media-player": "Playback",
  "backup": "Backup",
  "masking": "Privacy Masking",
};

// ================= MAIN RENDERER =================
export default function PageRenderer({ activePage, onNavigate }) {
  const { user, supervisorUnlocked, unlockSupervisor } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;

  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  const [pendingPage, setPendingPage] = useState(null);

  // --- Operator: hard-block any page not in their allowed list ---
  useEffect(() => {
    if (role === "operator" && !OPERATOR_ALLOWED_PAGES.includes(activePage)) {
      navigate("/designer-view", { replace: true });
    }
  }, [activePage, role, navigate]);

  // --- Admin check: hard-block user-management for non-admins ---
  useEffect(() => {
    if (activePage === "user-management" && role !== "admin") {
      navigate("/live-view", { replace: true });
    }
  }, [activePage, role, navigate]);

  // --- Client: check if current page needs supervisor unlock ---
  useEffect(() => {
    if (role === "client" && CLIENT_SUPERVISOR_PAGES.includes(activePage) && !supervisorUnlocked) {
      setPendingPage(activePage);
      setShowSupervisorModal(true);
    } else {
      setShowSupervisorModal(false);
      setPendingPage(null);
    }
  }, [activePage, role, supervisorUnlocked]);

  // Handle supervisor modal success — modal already verified the password
  const handleSupervisorSuccess = () => {
    unlockSupervisor();
    setShowSupervisorModal(false);
    setPendingPage(null);
  };

  // Handle supervisor modal cancel — go back to live-view
  const handleSupervisorCancel = () => {
    setShowSupervisorModal(false);
    setPendingPage(null);
    navigate("/live-view", { replace: true });
  };

  // Render supervisor modal overlay instead of the page
  if (showSupervisorModal && pendingPage) {
    return (
      <SupervisorModal
        pageName={SUPERVISOR_PAGE_NAMES[pendingPage] || pendingPage}
        onSuccess={handleSupervisorSuccess}
        onCancel={handleSupervisorCancel}
      />
    );
  }

  // For operator, don't render a blocked page (redirect handled in useEffect)
  if (role === "operator" && !OPERATOR_ALLOWED_PAGES.includes(activePage)) {
    return null;
  }

  // ✅ fallback to dashboard if page not found
  const Component = MAP[activePage] || DashboardPage;
  return <Component onNavigate={onNavigate || ((page) => navigate(`/${page}`))} />;
}
