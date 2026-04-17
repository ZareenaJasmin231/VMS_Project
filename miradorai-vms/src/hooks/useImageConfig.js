import { useState, useEffect } from 'react';

export const DEFAULT_IMAGE_VALS = {
  brightness: 0, colorLevel: 0, sharpness: 0, contrast: 0,
  whiteBalance: "", rotateImage: "",
  autoRotation: false, mirrorImage: false,
  backlightComp: false,
  dynamicContrast: false, dynamicContrastLevel: 0,
};

export function buildCSSFilter(vals) {
  const brightness = 1 + (vals.brightness / 100);
  let contrast = 1 + (vals.contrast / 100);
  if (vals.dynamicContrast) contrast += vals.dynamicContrastLevel / 200;
  const backlightBoost = vals.backlightComp ? 0.15 : 0;
  const saturate = 1 + (vals.colorLevel / 100);
  const sharpnessContrast = 1 + (vals.sharpness / 400);
  let hueRotate = 0, sepia = 0;
  if (vals.whiteBalance === "Sunny")    { hueRotate = 5;  sepia = 0.05; }
  if (vals.whiteBalance === "Cloudy")   { hueRotate = -5; sepia = 0.08; }
  if (vals.whiteBalance === "Indoor")   { hueRotate = 15; sepia = 0.12; }
  if (vals.whiteBalance === "Tungsten") { hueRotate = 25; sepia = 0.18; }
  return [
    `brightness(${Math.max(0.1, brightness + backlightBoost).toFixed(3)})`,
    `contrast(${Math.max(0.1, contrast * sharpnessContrast).toFixed(3)})`,
    `saturate(${Math.max(0, saturate).toFixed(3)})`,
    hueRotate !== 0 ? `hue-rotate(${hueRotate}deg)` : "",
    sepia > 0 ? `sepia(${sepia})` : "",
  ].filter(Boolean).join(" ") || "none";
}

export function buildTransform(vals) {
  const parts = [];
  if (vals.mirrorImage) parts.push("scaleX(-1)");
  if (vals.rotateImage) parts.push(`rotate(${vals.rotateImage}deg)`);
  return parts.join(" ") || "none";
}

export function useImageConfig(cameraId) {
  const [vals, setVals] = useState(DEFAULT_IMAGE_VALS);

  useEffect(() => {
    if (!cameraId) {
      setVals(DEFAULT_IMAGE_VALS);
      return;
    }
    
    const load = () => {
      try {
        const saved = localStorage.getItem(`miradorai_imgconf_${cameraId}`);
        if (saved) setVals(JSON.parse(saved));
        else setVals(DEFAULT_IMAGE_VALS);
      } catch {
        setVals(DEFAULT_IMAGE_VALS);
      }
    };
    
    load();

    const handleStorage = (e) => {
      if (!e) load(); // custom event dispatch
      else if (e.key === `miradorai_imgconf_${cameraId}`) load(); // StorageEvent from other tabs
    };

    window.addEventListener("miradorai_imgconf_changed", handleStorage);
    window.addEventListener("storage", handleStorage);
    
    return () => {
      window.removeEventListener("miradorai_imgconf_changed", handleStorage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [cameraId]);

  return {
    vals,
    cssFilter: buildCSSFilter(vals),
    cssTransform: buildTransform(vals)
  };
}
