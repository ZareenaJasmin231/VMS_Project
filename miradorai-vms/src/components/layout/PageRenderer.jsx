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
import StreamingPage from "../../pages/client/StreamingPage";
import AboutPage from "../../pages/client/AboutPage";

import FirmwareUpgradePage from "../../pages/connectedservices/Firmwareupgradepage";
import SmartSearchSettingsPage from "../../pages/smartsearcxh/Smartsearchsettingspage";

import LiveViewPage from "../../pages/liveview/LiveViewPage";

import MediaPlayerPage from "../../pages/admin/MediaPlayerPage";
import BackupPage from "../../pages/admin/BackupPage";
import LogsPage from "../../pages/logs/LogsPage";

// ✅ IMPORTANT PAGES
import DashboardPage from "../../pages/Dashboard/DashboardPage";




// ================= PAGE MAP =================
const MAP = {

  // ✅ DASHBOARD (DEFAULT PAGE)
  "dashboard": DashboardPage,

  // ✅ ANALYTICS (NEW)

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
  "streaming": StreamingPage,
  "about": AboutPage,

  // ================= SERVICES =================
  "firmware-upgrade": FirmwareUpgradePage,
  "smartsearch-settings": SmartSearchSettingsPage,

  // ================= LIVE =================
  "live-view": LiveViewPage,

  // ================= ADMIN =================
  "media-player": MediaPlayerPage,
  "backup": BackupPage,
  "logs": LogsPage,

};


// ================= MAIN RENDERER =================
export default function PageRenderer({ activePage, onNavigate }) {

  // ✅ fallback to dashboard if page not found
  const Component = MAP[activePage] || DashboardPage;

  return <Component onNavigate={onNavigate} />;
}