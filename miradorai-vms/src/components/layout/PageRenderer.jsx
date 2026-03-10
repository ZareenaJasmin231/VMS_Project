import AddDevicesPage     from "../../pages/devices/AddDevicesPage";
import CamerasPage        from "../../pages/devices/CamerasPage";
import OtherDevicesPage   from "../../pages/devices/OtherDevicesPage";
import StreamProfilesPage from "../../pages/devices/StreamProfilesPage";
import ImageConfigPage    from "../../pages/devices/ImageConfigPage";
import PTZPresetsPage     from "../../pages/devices/PTZPresetsPage";
import ManagementPage     from "../../pages/devices/ManagementPage";
import ExternalDataPage   from "../../pages/devices/ExternalDataPage";
import TimeSyncPage       from "../../pages/devices/TimeSyncPage";
import StorageMgmtPage    from "../../pages/storage/StorageManagementPage";
import StorageSelPage     from "../../pages/storage/StorageSelectionPage";
import RecordingPage      from "../../pages/recording/RecordingPage";
import EventsPage         from "../../pages/recording/EventsPage";
import TriggersPage       from "../../pages/recording/TriggersPage";
import ClientSettingsPage from "../../pages/client/ClientSettingsPage";
import AboutPage          from "../../pages/client/AboutPage";

const MAP = {
  "add-devices":       <AddDevicesPage />,
  "cameras":           <CamerasPage />,
  "other-devices":     <OtherDevicesPage />,
  "stream-profiles":   <StreamProfilesPage />,
  "image-config":      <ImageConfigPage />,
  "ptz-presets":       <PTZPresetsPage />,
  "device-mgmt":       <ManagementPage />,
  "ext-data":          <ExternalDataPage />,
  "time-sync":         <TimeSyncPage />,
  "storage-mgmt":      <StorageMgmtPage />,
  "storage-selection": <StorageSelPage />,
  "recording":         <RecordingPage />,
  "events":            <EventsPage />,
  "triggers":          <TriggersPage />,
  "client-settings":   <ClientSettingsPage />,
  "about":             <AboutPage />,
};

export default function PageRenderer({ activePage }) {
  return MAP[activePage] || <AddDevicesPage />;
}
