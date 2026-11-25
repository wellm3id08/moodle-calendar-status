async function openStatusCache(site, ttl) {
  const storageKey = 'mse.recent.v402';
  const profile = document.querySelector('.usermenu a[href*="/user/profile.php"]')?.href || '';
  // A new login in the same tab gets a separate cache.
  const bytes = new TextEncoder().encode([site.base, site.key, profile].join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const scope = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const recent = new Map();
  const confirmed = new Set(['graded', 'submitted', 'pending', 'missing']);
  const isFresh = item => confirmed.has(item?.status) && Number.isFinite(item.checked) &&
    Date.now() >= item.checked && Date.now() - item.checked < ttl;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved?.scope === scope) {
      for (const [url, item] of saved.rows) {
        if (isFresh(item)) recent.set(url, item);
      }
    }
  } catch {
    // Start with an empty cache if saved data is unreadable.
  }

  let queued = false;
  function persist() {
    queued = false;
    const rows = [...recent].filter(([, item]) => isFresh(item)).slice(-150);
    recent.clear();
    for (const [url, item] of rows) recent.set(url, item);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ scope, rows }));
    } catch {
      // The in-memory entries still work if the browser blocks storage.
    }
  }

  function scheduleWrite() {
    if (queued) return;
    queued = true;
    queueMicrotask(persist);
  }

  return {
    get(url) {
      const item = recent.get(url);
      return isFresh(item) ? item : null;
    },
    set(activity) {
      const url = new URL(activity.url);
      if (!/\/view\.php$/.test(url.pathname) || !/^\?id=\d+$/.test(url.search)) return;
      recent.delete(activity.url);
      if (isFresh(activity)) {
        const { status, checked, course } = activity;
        recent.set(activity.url, { status, checked, course });
      }
      scheduleWrite();
    },
    forget(url) {
      if (recent.delete(url)) scheduleWrite();
    }
  };
}
