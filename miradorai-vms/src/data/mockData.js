export const MOCK_DEVICES = [
  { id: 1, type: "panoramic", name: "Security Panoramic Overview",   ip: "192.168.1.101", mac: "AC:CC:8E:01:2A:FF", status: "Online",  manufacturer: "AXIS", model: "P3245-V" },
  { id: 2, type: "entrance",  name: "Station Entrance Multisensor",  ip: "192.168.1.102", mac: "AC:CC:8E:02:3B:AA", status: "Online",  manufacturer: "AXIS", model: "P8815-2" },
  { id: 3, type: "ptz",       name: "Station PTZ Orientation A",     ip: "192.168.1.103", mac: "AC:CC:8E:03:4C:BB", status: "Offline", manufacturer: "AXIS", model: "Q6135-LE" },
  { id: 4, type: "zoom",      name: "Station PTZ Zoom A",            ip: "192.168.1.104", mac: "AC:CC:8E:04:5D:CC", status: "Online",  manufacturer: "AXIS", model: "Q6155-E" },
];

export const MOCK_CAMERAS = [
  { id: 1, type: "panoramic", name: "Security Panoramic Overview",   address: "192.168.1.101", mac: "AC:CC:8E:01:2A:FF", manufacturer: "AXIS", model: "P3245-V",  channel: "1", server: "MIRADORAI-SRV" },
  { id: 2, type: "entrance",  name: "Station Entrance Multisensor",  address: "192.168.1.102", mac: "AC:CC:8E:02:3B:AA", manufacturer: "AXIS", model: "P8815-2",  channel: "1", server: "MIRADORAI-SRV" },
  { id: 3, type: "ptz",       name: "Station PTZ Orientation A",     address: "192.168.1.103", mac: "AC:CC:8E:03:4C:BB", manufacturer: "AXIS", model: "Q6135-LE", channel: "1", server: "MIRADORAI-SRV" },
  { id: 4, type: "zoom",      name: "Station PTZ Zoom A",            address: "192.168.1.104", mac: "AC:CC:8E:04:5D:CC", manufacturer: "AXIS", model: "Q6155-E",  channel: "1", server: "MIRADORAI-SRV" },
];

export const MGMT_TOOLBAR = [
  { label: "Properties",      icon: "⊹" },
  { label: "Update Firmware", icon: "↓" },
  { label: "Date & Time",     icon: "◷" },
  { label: "Security",        icon: "◈" },
  { label: "Network",         icon: "⬡" },
  { label: "Customize",       icon: "✦" },
  { label: "Restart",         icon: "↺" },
];
