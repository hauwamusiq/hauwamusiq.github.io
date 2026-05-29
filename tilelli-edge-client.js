/*
Form: Browser JavaScript
Runtime: Browser
Purpose: Shared Tilelli edge client for GitHub Pages surfaces.
Inputs: Current page URL, navigator metadata, public Tilelli Worker API.
Outputs: window.TilelliEdge helper and best-effort client event writes.
Safety: Contains no owner secrets; event logging is public and non-blocking.
Relations: workers/tilelli-api/src/index.js, index.html, tilaelia.html, clock.html, gaia.html, lani.html, esp.html.
*/

(() => {
  const API_BASE = "https://tilelli-api.hauwamusiq.workers.dev";

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Tilelli edge request failed: ${response.status}`);
    return response.json();
  }

  function event(type, payload = {}) {
    const body = JSON.stringify({
      type,
      path: location.pathname,
      title: document.title,
      referrer: document.referrer || "",
      payload,
      at: new Date().toISOString()
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API_BASE}/v1/events`, new Blob([body], { type: "application/json" }));
      return;
    }
    request("/v1/events", { method: "POST", body }).catch(() => {});
  }

  window.TilelliEdge = {
    apiBase: API_BASE,
    request,
    event,
    projects: () => request("/v1/projects"),
    portfolioEntries: query => request(`/v1/portfolio/entries${query ? `?${query}` : ""}`),
    physicsNotes: () => request("/v1/physics/notes"),
    reminders: () => request("/v1/dashboard/reminders")
  };

  event("page.view", {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    language: navigator.language || ""
  });
})();
