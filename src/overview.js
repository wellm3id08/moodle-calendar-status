async function getAssignmentOverviews(entries, site, signal) {
  const endpoint = new URL('lib/ajax/service.php', site.base);
  endpoint.searchParams.set('sesskey', site.key);
  async function call(methodname, args) {
    const response = await fetch(endpoint, {
      method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args.map((params, index) => ({ index, methodname, args: params })))
    });
    if (!response.ok) throw new Error('Resumen no disponible');
    const replies = await response.json();
    if (!Array.isArray(replies)) throw new Error('Respuesta inesperada');
    return replies;
  }

  const result = new Map();
  const courses = new Map();
  const eventLinks = new Map();
  for (const entry of entries) {
    if (entry.course) {
      courses.set(entry.url, entry.course);
      continue;
    }
    for (const link of entry.links) {
      if (link.dataset.eventId) eventLinks.set(link.dataset.eventId, entry.url);
    }
  }
  if (eventLinks.size) {
    const month = document.querySelector('.maincalendar .dropdown-item[data-view="month"][data-year], .calendarwrapper[data-view="month"][data-year]');
    if (month) {
      const args = { year: Number(month.dataset.year), month: Number(month.dataset.month), includenavigation: false };
      const [reply] = await call('core_calendar_get_calendar_monthly_view', [args]);
      for (const week of reply?.data?.weeks || []) {
        for (const day of week.days || []) {
          for (const event of day.events || []) {
            const url = eventLinks.get(String(event.id));
            if (url && event.url === url && event.modulename === 'assign' && Number.isSafeInteger(event.course?.id)) {
              courses.set(url, event.course.id);
            }
          }
        }
      }
    }
  }

  const courseIds = [...new Set(courses.values())];
  const coursesPerRequest = 8;
  for (let offset = 0; offset < courseIds.length; offset += coursesPerRequest) {
    const batch = courseIds.slice(offset, offset + coursesPerRequest);
    const replies = await call('core_courseformat_get_overview_information', batch.map(courseid => ({ courseid, modname: 'assign' })));
    for (const [index, reply] of replies.entries()) {
      const course = batch[index];
      if (!course || reply.error || reply.data?.courseid !== course) continue;
      for (const row of reply.data.activities || []) {
        if (row.haserror || row.modname !== 'assign' || !Number.isSafeInteger(row.cmid)) continue;
        const url = new URL('mod/assign/view.php?id=' + row.cmid, site.base).href;
        if (courses.get(url) !== course) continue;
        const status = overviewStatus(row.items);
        if (status) result.set(url, { course, status });
      }
    }
  }
  return result;
}

function overviewStatus(items) {
  if (!Array.isArray(items)) return null;
  const delivery = items.find(item => item.key === 'submissionstatus');
  const grade = items.find(item => /^(grade|calificación)$/i.test(item.key));
  if (delivery?.contenttype !== 'basic' || grade?.contenttype !== 'basic') return null;
  try {
    const gradeText = String(JSON.parse(grade.contentjson).content ?? '').trim();
    const state = String(JSON.parse(delivery.contentjson).content ?? '').trim().toLowerCase();
    if (/^\d+(?:[.,]\d+)?$/.test(gradeText)) return 'graded';
    if (!/^[-\u2013\u2014]$/.test(gradeText)) return null;
    if (/^(no entregad[oa]|no enviado|no submission|not submitted)$/.test(state)) return 'missing';
    if (/^(borrador|draft)(?: \(.*\))?$/.test(state)) return 'pending';
    if (/^(enviado para calificar|entregado para calificar|submitted for grading)$/.test(state)) return 'submitted';
  } catch {
    // The caller checks the activity page when Moodle returns an unfamiliar format.
    return null;
  }
  return null;
}
