/**
 * CctvCalculators.js
 * Utility functions for CCTV engineering calculations based on industry standards.
 */

/**
 * Calculates storage requirement in GB.
 * @param {number} bitrate - Avg bitrate per camera in Mbps.
 * @param {number} cameras - Number of cameras.
 * @param {number} days - Retention period in days.
 * @returns {number} Storage in GB.
 */
export function calculateStorage(totalBitrateMbps, days) {
  if (!totalBitrateMbps || !days) return 0;
  return (totalBitrateMbps * 3600 * 24 * days) / (8 * 1024);
}

/**
 * Calculates total bandwidth in Mbps.
 * @param {number} bitrate - Avg bitrate per camera in Mbps.
 * @param {number} cameras - Number of cameras.
 * @returns {number} Total bandwidth in Mbps.
 */
export function calculateBandwidth(placedCameras) {
  if (!placedCameras?.length) return 0;
  return placedCameras.reduce((sum, p) => sum + (p.camera?.bitrateTypical ?? 4), 0);
}

/**
 * Calculates PPM (Pixels Per Meter) at a given scene width.
 * @param {number} horizontalPixels - Horizontal resolution of the camera.
 * @param {number} sceneWidthMeters - Width of the scene in meters at a specific distance.
 * @returns {number} PPM value.
 */
export function calculatePPM(horizontalPixels, sceneWidthMeters) {
  if (!horizontalPixels || !sceneWidthMeters) return 0;
  return horizontalPixels / sceneWidthMeters;
}

/**
 * Returns the clarity level name and color based on PPM value.
 * @param {number} ppm 
 * @returns {object} { label: string, color: string }
 */
export function getClarityFromPPM(ppm) {
  if (ppm >= 80) return { label: "Identification", color: "#10b981" }; // Green
  if (ppm >= 60) return { label: "Recognition", color: "#f59e0b" };    // Orange
  if (ppm >= 40) return { label: "Classification", color: "#3b82f6" }; // Blue
  return { label: "Detection", color: "#ef4444" };                     // Red
}

/**
 * Recommends hardware based on camera count.
 */
export function getHardwareRecommendations(cameraCount) {
  let nvr = "4-Channel NVR";
  if (cameraCount > 32) nvr = "64-Channel NVR";
  else if (cameraCount > 16) nvr = "32-Channel NVR";
  else if (cameraCount > 8) nvr = "16-Channel NVR";
  else if (cameraCount > 4) nvr = "8-Channel NVR";

  const switches = Math.ceil(cameraCount / 8); // 8-port switches
  
  return {
    nvr,
    switches: `${switches} x 8-Port PoE Switch${switches > 1 ? "es" : ""}`
  };
}
