(() => {
  'use strict';

  const ROOT_ID = 'moodle-status-extension-root';
  if (document.getElementById(ROOT_ID)) return;
  const CALENDAR_AREA = '.maincalendar, .calendarwrapper, [data-region="calendar"], #region-main';
  const CALENDAR_EVENT = '[data-region="event"], .calendar_event, .calendar-event, .event, .calendarplugin_day, [data-timestamp]';
  const MAX_REQUESTS = 3;
  const ACTIVITY_TIMEOUT_MS = 25_000;
  const CACHE_TTL_MS = 2 * 60_000;
  const OVERVIEW_TIMEOUT_MS = 12_000;
  const logout = document.querySelector('a[href*="/login/logout.php"]');
  const logoutUrl = logout ? new URL(logout.href) : null;
  const site = logoutUrl?.origin === location.origin && logoutUrl.searchParams.get('sesskey')
    ? { base: new URL('../', logoutUrl).href, key: logoutUrl.searchParams.get('sesskey') } : null;
  let cache;
  let ready = false;
  const labels = {
    checking: 'Comprobando…',
    unknown: 'Estado no indicado',
    offline: 'Error de conexión',
    session: 'Inicia sesión',
    denied: 'Sin acceso',
    unavailable: 'Actividad no disponible',
    missing: 'No entregada',
    pending: 'Pendiente',
    submitted: 'Entregada',
    graded: 'Calificada'
  };
  const records = new Map();
  const badges = new Map();
  const dateFormat = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const onCalendar = () => /\/calendar\//i.test(location.pathname);
  const normalize = value => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  function rowValue(scope, heading) {
    for (const row of scope.querySelectorAll('tr')) {
      if (row.cells.length >= 2 && heading.test(normalize(row.cells[0].textContent))) {
        return normalize(row.cells[1].textContent);
      }
    }
    return '';
  }

  function readAssignmentStatus(main) {
    const table = main.querySelector('.submissionstatustable') || main;
    const grade = rowValue(table, /^(estado de (la )?calificacion|grading status):?$/);
    const delivery = rowValue(table, /^(estado de (la )?entrega|submission status):?$/);
    if (table.querySelector('.submissiongraded') || /^(calificad[oa]|graded)$/.test(grade)) return 'graded';
    if (table.querySelector('.submissionstatusdraft') || /borrador|draft/.test(delivery)) return 'pending';
    if (table.querySelector('.submissionstatusnotsubmitted, .submissionstatusnew') ||
        /no se han realizado envios|no (se ha|entregad|enviad|submission|submissions)|not submitted|sin entrega|ninguna entrega/.test(delivery)) return 'missing';
    if (table.querySelector('.submissionstatussubmitted') ||
        /^(enviad[oa]|entregad[oa]|entrega realizada|submitted)\b/.test(delivery)) return 'submitted';

    const text = normalize((main.querySelector('.submissionstatus') || main).textContent);
    if (/(?:estado de (?:la )?calificacion|grading status)\s*:\s*(calificad[oa]|graded)\b/.test(text)) return 'graded';
    if (/(?:estado de (?:la )?entrega|submission status)\s*:\s*(enviad[oa]|entregad[oa]|submitted)\b/.test(text)) return 'submitted';
    if (/no se ha (?:realizado|hecho) ninguna entrega|no submissions? (?:has|have) been made/.test(text)) return 'missing';
    if (/borrador \(no enviado\)|draft \(not submitted\)/.test(text)) return 'pending';
    return 'unknown';
  }

  function readQuizStatus(main) {
    const text = normalize(main.textContent);
    const summary = normalize(main.querySelector('.quizattemptsummary')?.textContent);
    if (/intento en curso|attempt in progress|continuar (?:el |tu |el ultimo )?intento|continue (?:the |your |the last )?attempt/.test(text) ||
        /en curso|in progress/.test(summary)) return 'pending';
    const results = normalize(main.querySelector('#feedback, .quizgradefeedback')?.textContent);
    if (/(?:calificacion|grade)(?: final)?\s*[:=]?\s*\d/.test(results) ||
        /(?:final grade|calificacion final)\s*[:=]?\s*\d/.test(text)) return 'graded';
    if (/intento (?:finalizado|terminado)|attempt finished|review attempt|revisar intento/.test(text) ||
        /finalizado|terminado|finished/.test(summary)) return 'submitted';
    if (/no ha realizado ningun intento|no attempts have been made|(?:aun|todavia) no ha realizado este cuestionario/.test(text)) return 'missing';
    return 'unknown';
  }

  async function readStatus(activity, controller) {
    const expected = new URL(activity.url);
    // Some calendar links submit an action just by visiting the URL.
    if (!/\/(?:view|discuss|review)\.php$/.test(expected.pathname) ||
        ['sesskey', 'action', 'delete'].some(key => expected.searchParams.has(key))) return 'unknown';

    try {
      const response = await fetch(activity.url, {
        credentials: 'same-origin', cache: 'no-cache', signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (response.status === 401) return 'session';
      if (response.status === 403) return 'denied';
      if (response.status === 404 || response.status === 410) return 'unavailable';
      if (!response.ok) return 'offline';
      const actual = new URL(response.url);
      if (/\/login(?:\/|$)/.test(actual.pathname)) return 'session';
      if (actual.origin !== expected.origin || actual.pathname !== expected.pathname ||
          [...expected.searchParams].some(([key, value]) => actual.searchParams.get(key) !== value)) return 'unknown';
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const main = doc.querySelector('#region-main, main, [role="main"]') || doc.body;
      if (doc.querySelector('body#page-login-index, form#login input[type="password"]')) return 'session';
      if (doc.querySelector('.errorcode')?.textContent.trim()) return 'unavailable';
      main.querySelectorAll('script, style, template, noscript').forEach(node => node.remove());
      if (activity.module === 'assign') return readAssignmentStatus(main);
      if (activity.module === 'quiz') return readQuizStatus(main);
      return /\b(actividad completada|activity completed)\b/.test(normalize(main.textContent)) ? 'submitted' : 'unknown';
    } catch {
      return 'offline';
    }
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <button type="button" class="mse-fab" aria-label="Estado de entregas" aria-controls="mse-panel" aria-expanded="false">✓</button>
    <aside class="mse-panel" id="mse-panel" aria-label="Estado de entregas">
      <div class="mse-header-row"><div><div class="mse-title">Estado de entregas</div><div class="mse-subtitle"></div></div>
        <button type="button" class="mse-icon-button" title="Actualizar" aria-label="Actualizar estados">↻</button>
      </div>
      <div class="mse-stats"></div>
      <div class="mse-section-title">Próximas actividades</div><div class="mse-upcoming"></div>
    </aside>`;
  document.documentElement.append(root);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  const counters = new Map();
  for (const [key, label] of Object.entries({
    missing: 'No entregadas', pending: 'Pendientes', submitted: 'Entregadas', graded: 'Calificadas'
  })) {
    const stat = element('div', 'mse-stat', '');
    const count = element('strong', '', '0');
    counters.set(key, count);
    stat.append(count, element('span', '', label));
    root.querySelector('.mse-stats').append(stat);
  }

  function renderPanel() {
    if (!root.classList.contains('mse-open')) return;
    const counts = Object.fromEntries(Object.keys(labels).map(key => [key, 0]));
    const upcoming = [];
    const cutoff = Date.now() - 86_400_000;
    for (const activity of records.values()) {
      counts[activity.status]++;
      if (activity.date >= cutoff) upcoming.push(activity);
    }
    const messages = [records.size === 1 ? '1 actividad detectada' : records.size + ' actividades detectadas'];
    if (counts.checking) messages.push(counts.checking + ' en comprobación');
    const unconfirmed = counts.unknown + counts.offline + counts.session + counts.denied + counts.unavailable;
    if (unconfirmed) messages.push(unconfirmed + ' sin estado confirmado');
    root.querySelector('.mse-subtitle').textContent = onCalendar() ? messages.join(' · ') : 'Abre el calendario para consultar tus entregas.';
    for (const [key, node] of counters) node.textContent = counts[key];
    const items = upcoming.sort((a, b) => a.date - b.date).slice(0, 8).map(activity => {
      const item = element('div', 'mse-upcoming-item', '');
      const top = element('div', 'mse-upcoming-top', '');
      top.append(element('span', 'mse-upcoming-name', activity.title), element('span', 'mse-status mse-' + activity.status, labels[activity.status]));
      item.append(top, element('div', 'mse-upcoming-meta', dateFormat.format(activity.date)));
      return item;
    });
    if (!items.length) items.push(element('div', 'mse-empty', 'Sin fechas próximas detectadas.'));
    root.querySelector('.mse-upcoming').replaceChildren(...items);
  }

  let panelUpdateQueued = false;
  function updatePanel() {
    if (panelUpdateQueued || !root.classList.contains('mse-open')) return;
    panelUpdateQueued = true;
    queueMicrotask(() => {
      panelUpdateQueued = false;
      renderPanel();
    });
  }

  function updateBadges(activity) {
    for (const link of activity.links) {
      let badge = badges.get(link);
      if (!badge) {
        badge = link.nextElementSibling?.matches('.mse-status-wrap')
          ? link.nextElementSibling : document.createElement('span');
        badges.set(link, badge);
      }
      if (badge.dataset.mseStatus !== activity.status) {
        badge.dataset.mseStatus = activity.status;
        badge.className = 'mse-status-wrap mse-status mse-' + activity.status;
        badge.textContent = labels[activity.status];
      }
      if (link.nextElementSibling !== badge) link.after(badge);
    }
  }

  function eventDate(link) {
    const box = link.closest(CALENDAR_EVENT) || link.parentElement;
    const date = Date.parse(box.querySelector('time[datetime]')?.dateTime);
    if (Number.isFinite(date)) return date;
    const stamp = box.closest('[data-time], [data-timestamp], [data-day-timestamp]');
    const seconds = stamp?.dataset.time || stamp?.dataset.timestamp || stamp?.dataset.dayTimestamp;
    return /^\d{1,10}$/.test(seconds) ? Number(seconds) * 1000 : null;
  }

  const jobs = new Map();
  const queue = new Set();
  let suspended = false;

  let overviewBatch;
  function finishOverviewRequest(batch, rows) {
    if (overviewBatch !== batch) return;
    clearTimeout(batch.timer);
    overviewBatch = null;
    for (const activity of batch.members) {
      const row = rows?.get(activity.url);
      if (row) activity.course = row.course;
      if (row && !activity.recheck) {
        activity.verifying = false;
        saveResult(activity, row.status);
      } else {
        if (row && activity.recheck) {
          activity.triedOverview = false;
          activity.verifying = true;
        }
        activity.recheck = false;
        queue.add(activity);
      }
    }
    runQueue();
  }

  function startOverviewRequest() {
    if (overviewBatch || !site || queue.size < 3) return;
    const members = new Set([...queue].filter(activity => activity.module === 'assign' && !activity.triedOverview &&
      activity.url.startsWith(site.base + 'mod/assign/view.php?id=') &&
      (activity.course || activity.links.some(a => a.dataset.eventId))));
    if (members.size < 3) return;
    const batch = { members, controller: new AbortController() };
    overviewBatch = batch;
    for (const activity of members) {
      queue.delete(activity);
      activity.triedOverview = true;
    }
    batch.expire = () => {
      batch.controller.abort();
      finishOverviewRequest(batch);
    };
    batch.until = Date.now() + OVERVIEW_TIMEOUT_MS;
    batch.timer = setTimeout(batch.expire, OVERVIEW_TIMEOUT_MS);
    getAssignmentOverviews(members, site, batch.controller.signal).then(
      rows => finishOverviewRequest(batch, rows), () => finishOverviewRequest(batch)
    );
  }

  function saveResult(activity, status) {
    activity.checked = Date.now();
    activity.status = status;
    cache?.set(activity);
    updateBadges(activity);
    updatePanel();
  }

  function cancel(activity) {
    queue.delete(activity);
    if (overviewBatch?.members.delete(activity) && !overviewBatch.members.size) {
      clearTimeout(overviewBatch.timer);
      overviewBatch.controller.abort();
      overviewBatch = null;
    }
    const job = jobs.get(activity);
    if (!job) return;
    jobs.delete(activity);
    clearTimeout(job.timer);
    job.controller.abort();
  }

  function finishActivityRequest(activity, job, result) {
    if (jobs.get(activity) !== job) return;
    jobs.delete(activity);
    clearTimeout(job.timer);
    if (activity.recheck) {
      activity.verifying = true;
      activity.attempt = 0;
      queue.add(activity);
    } else if (result === 'offline' && activity.attempt < 2) {
      queue.add(activity);
    } else {
      activity.verifying = false;
      saveResult(activity, result);
    }
    activity.recheck = false;
    runQueue();
  }

  function runQueue() {
    if (suspended) return;
    startOverviewRequest();
    const availableSlots = overviewBatch ? MAX_REQUESTS - 1 : MAX_REQUESTS;
    while (jobs.size < availableSlots && queue.size) {
      const activity = queue.values().next().value;
      queue.delete(activity);
      activity.attempt++;
      const job = { controller: new AbortController(), until: Date.now() + ACTIVITY_TIMEOUT_MS };
      jobs.set(activity, job);
      job.expire = () => {
        job.controller.abort();
        finishActivityRequest(activity, job, 'offline');
      };
      job.timer = setTimeout(job.expire, ACTIVITY_TIMEOUT_MS);
      readStatus(activity, job.controller).then(result => finishActivityRequest(activity, job, result), job.expire);
    }
  }

  function collectActivities() {
    const groups = new Map();
    if (!onCalendar()) return groups;
    for (const link of document.querySelectorAll('a[href*="/mod/"]')) {
      if (!link.closest(CALENDAR_AREA)) continue;
      let url;
      try {
        url = new URL(link.href);
      } catch {
        continue;
      }
      const module = url.pathname.match(/\/mod\/([^/]+)\//i)?.[1];
      if (url.origin !== location.origin || !module) continue;
      url.hash = '';
      // The same activity can appear on several days with different display parameters.
      const id = url.searchParams.get('id');
      if (url.pathname.endsWith('/view.php') && /^\d+$/.test(id)) url.search = '?id=' + id;
      const key = url.href;
      if (!groups.has(key)) {
        const title = link.textContent.trim() || link.title || 'Actividad';
        groups.set(key, { url: key, module, links: [], date: null, title });
      }
      const group = groups.get(key);
      group.links.push(link);
      group.date ??= eventDate(link);
    }
    return groups;
  }

  function scan(force = false) {
    if (suspended || !ready) return;
    const groups = collectActivities();
    const liveLinks = new Set();
    for (const group of groups.values()) {
      for (const link of group.links) liveLinks.add(link);
    }
    for (const [link, badge] of badges) {
      if (liveLinks.has(link)) continue;
      badge.remove();
      badges.delete(link);
    }
    for (const [key, activity] of records) {
      if (groups.has(key)) continue;
      cancel(activity);
      records.delete(key);
    }
    for (const [key, group] of groups) {
      const activity = records.get(key) || { status: 'checking', checked: 0, attempt: 0, ...cache?.get(key) };
      Object.assign(activity, group);
      records.set(key, activity);
      if (jobs.has(activity) || overviewBatch?.members.has(activity)) {
        if (force && !activity.verifying) activity.recheck = true;
      } else if (!queue.has(activity) && (force || Date.now() - activity.checked >= CACHE_TTL_MS)) {
        activity.attempt = 0;
        activity.triedOverview = false;
        queue.add(activity);
      }
      updateBadges(activity);
    }
    // Moodle can clone populated calendar markup when it replaces a month.
    for (const badge of document.querySelectorAll('.mse-status-wrap')) {
      if (badges.get(badge.previousElementSibling) !== badge) badge.remove();
    }
    if (overviewBatch && overviewBatch.until <= Date.now()) overviewBatch.expire();
    for (const job of [...jobs.values()]) if (job.until <= Date.now()) job.expire();
    runQueue();
    updatePanel();
  }

  const toggle = root.querySelector('.mse-fab');
  toggle.addEventListener('click', () => {
    const open = root.classList.toggle('mse-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) renderPanel();
  });
  root.querySelector('.mse-icon-button').addEventListener('click', () => scan(true));

  const relevant = 'a[href*="/mod/"], time[datetime], [data-time], [data-timestamp]';
  function affectsCalendar(mutation) {
    const target = mutation.target;
    if (root.contains(target) || target.parentElement?.closest('.mse-status-wrap')) return false;
    if (mutation.type === 'attributes') return !!target.closest(CALENDAR_AREA);
    if (target.nodeType === 1 && target.closest('a[href*="/mod/"]')) return true;
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant)));
  }
  const observer = new MutationObserver(changes => {
    if (changes.some(affectsCalendar)) scan();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['href', 'datetime', 'data-time', 'data-timestamp'] });

  let away = document.hidden;
  let lastResume = 0;
  function resume() {
    if (!away || document.hidden) return;
    away = false;
    const now = Date.now();
    const recheck = now - lastResume > 15_000;
    lastResume = now;
    scan(recheck);
  }
  window.addEventListener('blur', () => { away = true; });
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) away = true;
    else resume();
  });
  function suspend() {
    suspended = true;
    for (const activity of records.values()) {
      cancel(activity);
      activity.checked = 0;
      activity.recheck = false;
      activity.verifying = false;
    }
  }
  function restore() {
    if (!suspended) return;
    suspended = false;
    lastResume = Date.now();
    scan();
    renderPanel();
  }
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', restore);
  document.addEventListener('freeze', suspend);
  document.addEventListener('resume', restore);
  window.addEventListener('online', () => scan(true));
  window.addEventListener('popstate', () => scan());
  window.navigation?.addEventListener('currententrychange', () => scan());

  async function boot() {
    if (site) {
      try {
        cache = await openStatusCache(site, CACHE_TTL_MS);
      } catch {
        // Calendar checks also work when the tab cache is unavailable.
      }
    }
    ready = true;
    if (cache && /\/mod\/[^/]+\/view\.php$/.test(location.pathname)) {
      const id = new URL(location.href).searchParams.get('id');
      if (/^\d+$/.test(id)) cache.forget(location.origin + location.pathname + '?id=' + id);
    }
    scan();
  }
  boot();
})();
