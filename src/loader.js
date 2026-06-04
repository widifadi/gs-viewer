export async function loadManifest(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
  return res.json();
}
