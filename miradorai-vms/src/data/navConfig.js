// ================= NAVIGATION CONFIGURATION =================
// Contains all navigation items for Mirador VMS

// ================= CORE NAVIGATION =================
const CORE_NAV = [
  // ✅ DASHBOARD
  {
    section: "Dashboard",
    page: "dashboard",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
    </svg>`,
  },

  // ✅ LIVE VIEW
  {
    section: "Live View",
    page: "live-view",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>`,
  },



  // ✅ CAMERAS
  {
    section: "Cameras",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </svg>`,
    items: [
      {
        label: "Add Device",
        page: "add-devices",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`,
      },
      {
        label: "Camera Groups",
        page: "cameras",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
      },
    ],
  },
  {
    section: "Masking",
    page: "masking",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <rect x="8" y="8" width="8" height="8" rx="1"/>
      <path d="M3 8h2M19 8h2M3 16h2M19 16h2M8 3v2M16 3v2M8 19v2M16 19v2"/>
    </svg>`,
  },
  // ✅ RECORDING & EVENTS
  {
    section: "Recording & Events",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>`,
    items: [
      { label: "Schedules", page: "schedules" },
      { label: "Recording Method", page: "rec-method" },
      { label: "Action Rules", page: "action-rules" },
    ],
  },

  // ✅ STORAGE
  {
    section: "Storage",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
    </svg>`,
    items: [
      { label: "Management", page: "storage-mgmt" },
    ],
  },

];

// ================= ADMIN ONLY NAVIGATION =================
const ADMIN_ONLY_NAV = [
  // ✅ MEDIA PLAYER
  {
    section: "Playback",
    page: "media-player",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>`,
  },

  // ✅ BACKUP
  {
    section: "Backup",
    page: "backup",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M12 16v-8M8 12l4-4 4 4"/>
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
    </svg>`,
  },

  // ✅ LOGS
  {
    section: "Logs",
    page: "logs",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`,
  },

  //mapview
  // Add after the Logs entry in ADMIN_ONLY_NAV
  {
    section: "Map View",
    page: "map-view",

    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/>
      <line x1="16" y1="6" x2="16" y2="22"/>
    </svg>`,
  },
    {
  section: "Designer View",
  page: "designer-view",

  icon: `<svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M8 8h8v8H8z"/>
    <path d="M3 12h5M16 12h5"/>
  </svg>`,
},
  // ✅ INFRASTRUCTURE
  {
    section: "Infrastructure",
    page: "infrastructure",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/><path d="M12 10v4M12 10h4M12 14h4"/>
    </svg>`,
  },

];



// ============================================================
// NAV SETS per ROLE
// ============================================================

// Shared icons (re-used across role configs)
const ICONS = {
  liveView: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  addDevice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`,
  cameras: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  cameraGroups: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  masking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M3 8h2M19 8h2M3 16h2M19 16h2M8 3v2M16 3v2M8 19v2M16 19v2"/></svg>`,
  recording: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  storage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>`,
  playback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  backup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16v-8M8 12l4-4 4 4"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>`,
  client: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  infrastructure: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/><path d="M12 10v4M12 10h4M12 14h4"/></svg>`,
  about: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
};

// CLIENT nav — pages they can see in the sidebar
// (playback/backup/masking are visible but gated by SupervisorModal in PageRenderer)
const CLIENT_NAV = [
  { section: "Live View",  page: "live-view",  icon: ICONS.liveView },
  {
    section: "Cameras",
    icon: ICONS.cameras,
    items: [
      { label: "Add Device",     page: "add-devices", icon: ICONS.addDevice },
      { label: "Camera Groups",  page: "cameras",     icon: ICONS.cameraGroups },
    ],
  },
  { section: "Masking",  page: "masking",       icon: ICONS.masking },
  {
    section: "Recording & Events",
    icon: ICONS.recording,
    items: [
      { label: "Schedules",         page: "schedules" },
      { label: "Recording Method",  page: "rec-method" },
      { label: "Action Rules",      page: "action-rules" },
    ],
  },
  {
    section: "Storage",
    icon: ICONS.storage,
    items: [
      { label: "Management", page: "storage-mgmt" },
    ],
  },
  { section: "Playback", page: "media-player",  icon: ICONS.playback },
  { section: "Backup",   page: "backup",        icon: ICONS.backup },
  { section: "Infrastructure", page: "infrastructure", icon: ICONS.infrastructure },
  {
    section: "Map View",
    page: "map-view",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
  },
  {
    section: "Designer View",
    page: "designer-view",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/><path d="M3 12h5M16 12h5"/></svg>`,
  },
];

// OPERATOR nav — Live View, Add Devices, About only
const OPERATOR_NAV = [
  { section: "Live View",  page: "live-view",   icon: ICONS.liveView },
  {
    section: "Cameras",
    icon: ICONS.cameras,
    items: [
      { label: "Add Device", page: "add-devices", icon: ICONS.addDevice },
    ],
  },
];

// ================= GET NAVIGATION CONFIG =================
export const getNavConfig = (role = "client") => {
  if (role === "admin")    return [...CORE_NAV, ...ADMIN_ONLY_NAV];
  if (role === "client")   return CLIENT_NAV;
  if (role === "operator") return OPERATOR_NAV;
  return CLIENT_NAV; // fallback
};

// ================= DEFAULT EXPORT =================
export const NAV_CONFIG = CORE_NAV;

// ================= CAMERA FEATURES CONFIG =================
// All features shown in the right-side panel when a camera is selected.
export const CAMERA_FEATURES_CONFIG = [
  {
    label: "Stream Profiles",
    page: "stream-profiles",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14"/>
      <rect x="1" y="6" width="15" height="12" rx="2"/>
    </svg>`,
  },
  {
    label: "Image Config",
    page: "image-config",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`,
  },
  {
    label: "PTZ Presets",
    page: "ptz-presets",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8l1.5 3h3l-2.5 2 1 3L12 14.5 9 16l1-3-2.5-2h3z"/>
    </svg>`,
  },
  // {
  //   label: "Masking",
  //   page: "masking",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <rect x="3" y="3" width="18" height="18" rx="2"/>
  //     <rect x="8" y="8" width="8" height="8" rx="1"/>
  //     <path d="M3 8h2M19 8h2M3 16h2M19 16h2M8 3v2M16 3v2M8 19v2M16 19v2"/>
  //   </svg>`,
  // },
  // {
  //   label: "Camera Features",
  //   page: "camera-features",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
  //     <circle cx="12" cy="12" r="3"/>
  //   </svg>`,
  // },
  // {
  //   label: "IO Ports",
  //   page: "io-ports",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <rect x="2" y="7" width="20" height="10" rx="2"/>
  //     <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>
  //     <path d="M6 7V5M10 7V5M18 7V5M14 7V5"/>
  //   </svg>`,
  // },
  // {
  //   label: "External Data",
  //   page: "ext-data",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <ellipse cx="12" cy="5" rx="9" ry="3"/>
  //     <path d="M3 5v4c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
  //     <path d="M3 9v4c0 1.66 4.03 3 9 3s9-1.34 9-3V9"/>
  //     <path d="M3 13v4c0 1.66 4.03 3 9 3s9-1.34 9-3v-4"/>
  //   </svg>`,
  // },
  // {
  //   label: "Time Sync",
  //   page: "time-sync",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <circle cx="12" cy="12" r="10"/>
  //     <path d="M12 6v6l4 2"/>
  //   </svg>`,
  // },
  // {
  //   label: "Management",
  //   page: "device-mgmt",
  //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
  //     <circle cx="12" cy="12" r="3"/>
  //     <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  //   </svg>`,
  // },

];

// ================= PAGE TITLE MAPPING =================
export const PAGE_TITLES = {
  // Core pages
  dashboard: "Dashboard",
  "live-view": "Live View",
  analytics: "Video Analytics",
  "add-devices": "Add Device",
  cameras: "Cameras",
  schedules: "Recording Schedules",
  "rec-method": "Recording Method",
  "action-rules": "Action Rules",
  "storage-mgmt": "Storage Management",
  "client-settings": "Client Settings",
  "user-settings": "User Settings",
  profile: "Profile",
  about: "About",

  // Admin pages
  "media-player": "Playback",
  backup: "Backup",
  logs: "System Logs",
  infrastructure: "Infrastructure",

  // Camera feature pages
  "stream-profiles": "Stream Profiles",
  "image-config": "Image Configuration",
  "ptz-presets": "PTZ Presets",
  masking: "Privacy Masking",
  "camera-features": "Camera Features",
  "io-ports": "I/O Ports",
  "ext-data": "External Data",
  "time-sync": "Time Synchronization",
  "device-mgmt": "Device Management",
  "analytics-rules": "Analytics Rules",
    "designer-view": "Designer View",

};

// ================= HELPER FUNCTION =================
export const getPageTitle = (pageId) => {
  return PAGE_TITLES[pageId] || pageId?.replace(/-/g, ' ') || "Mirador VMS";
};