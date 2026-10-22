// Usage log: counts which features get used, kept only on this device. It
// never leaves the device unless someone exports it from Settings.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});
  const KEY = "ct.usage.v1";

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.counts) return raw;
    } catch (e) {
      /* fall through to a fresh log */
    }
    return { since: Date.now(), counts: {}, days: {} };
  }

  let data = load();
  let timer = null;

  function save() {
    clearTimeout(timer);
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage full: the log is the first thing to give up */
    }
  }

  function track(name) {
    if (!name) return;
    data.counts[name] = (data.counts[name] || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    const d = (data.days[day] = data.days[day] || {});
    d[name] = (d[name] || 0) + 1;
    data.last = Date.now();
    clearTimeout(timer);
    timer = setTimeout(save, 1500);
  }

  function summary() {
    return Object.entries(data.counts).sort((a, b) => b[1] - a[1]);
  }

  function exportData() {
    save();
    return { app: "commander-tracker-usage", version: 1, exportedAt: new Date().toISOString(), ...data };
  }

  function clear() {
    data = { since: Date.now(), counts: {}, days: {} };
    save();
  }

  root.addEventListener("pagehide", save);
  CT.Usage = { track, summary, exportData, clear, since: () => data.since, days: () => Object.keys(data.days).length };
})(window);
