const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function fetchMasks(cameraId) {
  const res = await fetch(`${BASE_URL}/api/masks/${cameraId}`);
  if (!res.ok) throw new Error("Failed to fetch masks");
  return res.json();
}

export async function saveMask(cameraId, maskData) {
  const res = await fetch(`${BASE_URL}/api/masks/${cameraId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(maskData),
  });
  if (!res.ok) throw new Error("Failed to save mask");
  return res.json();
}

export async function updateMask(maskId, updates) {
  const res = await fetch(`${BASE_URL}/api/masks/${maskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update mask");
  return res.json();
}

export async function deleteMask(maskId) {
  const res = await fetch(`${BASE_URL}/api/masks/${maskId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete mask");
  return res.json();
}