const BASE = import.meta.env.VITE_API_URL || "";

async function req(url, opts = {}) {
  const res = await fetch(BASE + url, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const fetchMasks          = (cameraId)         => req(`/api/masks/${cameraId}`);
export const fetchPipelineStatus = (cameraId)         => req(`/api/masks/status/${cameraId}`);
export const fetchPipelineDebug  = (cameraId)         => req(`/api/masks/debug/${cameraId}`);

export const saveMask   = (cameraId, body) => req(`/api/masks/${cameraId}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
export const updateMask = (maskId, body)   => req(`/api/masks/${maskId}`, {
  method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
export const deleteMask = (maskId)         => req(`/api/masks/${maskId}`, { method: "DELETE" });