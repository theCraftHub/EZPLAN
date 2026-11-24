class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { view: 'overview', sub: 'office-2', open: {}, whatIf: 'none', dept: null, task: null, thread: 'master', read: {}, draft: '', tdraft: '', posted: [], tposted: [], actPlan: 'all', actDept: 'all' };
  }
  renderVals() {
    var self = this, st = this.state, D = DATA;
    var DAY = 86400000;
    var ms = function (iso) { return Date.parse(iso + 'T00:00:00Z'); };
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var fmt = function (iso) { var d = new Date(ms(iso)); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
    var go = function (o) { return function () { self.setState(o); }; };
    // Department colors: validated colorblind-safe slots, always shown with the department's name.
    var DEPT = {
      Facilities: { c: '#2a78d6', soft: '#E3EEFB', ink: '#1C5CAB', who: 'Dana Reyes', role: 'Facilities lead' },
      IT: { c: '#eb6834', soft: '#FDEBE2', ink: '#9A3412', who: 'Ivan Petrov', role: 'IT lead' },
      HR: { c: '#1baf7a', soft: '#DDF5EC', ink: '#0F6B4A', who: 'Mei Chen', role: 'People and HR' },
      Finance: { c: '#eda100', soft: '#FCF0D2', ink: '#7A5300', who: 'Omar Haddad', role: 'Finance partner' },
      Safety: { c: '#e87ba4', soft: '#FBE6EE', ink: '#9D2B57', who: 'Tess Morgan', role: 'Safety officer' }
    };
    var deptChip = function (d) { var x = DEPT[d]; return { name: d, style: 'display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ' + x.soft + '; color: ' + x.ink + ';', dot: 'width: 8px; height: 8px; border-radius: 2px; background: ' + x.c + '; flex: none;' }; };
    var TARGET = { master: '2027-04-30', reception: '2027-04-02', kitchen: '2027-03-26', 'bathroom-1': '2027-03-26', 'bathroom-2': '2027-03-30', 'bathroom-3': '2027-04-09', 'office-1': '2027-04-16', 'office-2': '2027-04-23', 'office-3': '2027-04-23' };
    var NAME = { Kai: 'Kai Brooks', Leo: 'Leo Grant', Rosa: 'Rosa Diaz', Ivan: 'Ivan Petrov', Mei: 'Mei Chen', Omar: 'Omar Haddad', Tess: 'Tess Morgan', Dana: 'Dana Reyes', Noor: 'Noor Aziz' };
    var today = D.today;
    var scen = st.whatIf === 'noor' ? D.whatIfNoor : st.whatIf === 'cabinets' ? D.whatIfCabinets : null;
    var T = D.tasks.map(function (t) {
      var dd = scen && scen.dates[t.id];
      var s = dd ? dd[0] : t.start, e = dd ? dd[1] : t.end;
      var owner = dd && dd[2] ? dd[2] : t.owner;
      // As of the sample's "today": work that went to plan is done or under way.
      var status = t.status === 'done' || e < today ? 'done' : s <= today ? 'doing' : 'todo';
      return Object.assign({}, t, { start: s, end: e, owner: owner, st: status });
    });
    var byId = {}; T.forEach(function (t) { byId[t.id] = t; });
    var subTitle = {}; D.subs.forEach(function (s) { subTitle[s.key] = s.key === 'master' ? 'Whole building' : s.title; });
    var finish = scen ? scen.finish : D.finish;
    var moveIn = byId.T6;
    var lateDays = function (a, b) { var n = 0; for (var d = ms(b) + DAY; d <= ms(a); d += DAY) { var w = new Date(d).getUTCDay(); if (w && w < 6) n++; } return n; };
    var health = function (key, end) {
      if (end <= TARGET[key]) return { label: 'On track', style: 'color: #115E59; background: #CCFBF1;' };
      var n = lateDays(end, TARGET[key]);
      return n > 3 ? { label: 'Off track', n: n, style: 'color: #991B1B; background: #FEE2E2;' } : { label: 'At risk', n: n, style: 'color: #9A3412; background: #FFEDD5;' };
    };
    var chipBase = 'flex: none; font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 999px; white-space: nowrap; ';

    var subs = D.subs.filter(function (s) { return s.key !== 'master'; }).map(function (s) {
      var ts = T.filter(function (t) { return t.sub === s.key; });
      var start = ts.map(function (t) { return t.start; }).sort()[0], end = ts.map(function (t) { return t.end; }).sort().slice(-1)[0];
      var done = ts.filter(function (t) { return t.st === 'done'; }).length;
      var h = health(s.key, end);
      var waits = [];
      ts.forEach(function (t) { t.deps.forEach(function (d) { var o = byId[d]; if (o && o.sub !== s.key && o.st !== 'done' && waits.indexOf(o.id) < 0) waits.push(o.id); }); });
      var people = []; ts.forEach(function (t) { if (people.indexOf(t.owner) < 0) people.push(t.owner); });
      var pct = Math.round((done / ts.length) * 100);
      return { key: s.key, title: s.title, lead: deptChip(s.lead), needs: s.needs.map(deptChip), hasNeeds: s.needs.length > 0, start: start, end: end, when: fmt(start) + ' to ' + fmt(end), done: done, count: ts.length, pct: pct, pctLabel: pct + '%', bar: 'height: 100%; border-radius: 999px; background: #4F46E5; width: ' + pct + '%;', health: h.label + (h.n ? ' · ' + h.n + 'd late' : ''), healthStyle: chipBase + h.style,
        waits: waits.map(function (id) { return byId[id].title + ' (' + subTitle[byId[id].sub] + ')'; }), waitsLabel: waits.length ? 'Waits on ' + waits.map(function (id) { return byId[id].title; }).join(', ') : '',
        people: people.map(function (p) { return NAME[p]; }).join(', '), open: go({ view: 'plan', sub: s.key, task: null }), late: h.label !== 'On track' };
    });
    var masterTasks = T.filter(function (t) { return t.sub === 'master'; });
    var milestones = ['T3', 'T2', 'T1', 'T5', 'T6'].map(function (id) {
      var t = byId[id];
      var label = { T3: 'Budget approved', T2: 'Asbestos survey', T1: 'Permits approved', T5: 'Final walkthrough', T6: 'Move-in' }[id];
      var state = t.st === 'done' ? 'Done' : t.st === 'doing' ? 'Under way' : 'Planned';
      return { label: label, date: id === 'T6' ? fmt(t.end) : fmt(t.end), state: state, mark: 'width: 14px; height: 14px; transform: rotate(45deg); border-radius: 2px; flex: none; ' + (t.st === 'done' ? 'background: #0F766E;' : t.st === 'doing' ? 'background: #FFFFFF; border: 3px solid #4F46E5;' : 'background: #FFFFFF; border: 2px solid #94A3B8;') };
    });
    var all = T.filter(function (t) { return t.sub !== 'master'; });
    var pctAll = Math.round(T.filter(function (t) { return t.st === 'done'; }).length / T.length * 100);
    var hMaster = health('master', moveIn.end);
    var lateSubs = subs.filter(function (s) { return s.late; });

    // People across all sub-plans, by week: who is booked full, and on which plans.
    var weeks = [];
    for (var w = ms('2027-03-01'); w <= ms('2027-05-03'); w += 7 * DAY) weeks.push(new Date(w).toISOString().slice(0, 10));
    var people = Object.keys(D.people);
    if (st.whatIf === 'noor') people.push('Noor');
    var hours = function (who) { return (D.weekly[st.whatIf] || D.weekly.none)[who] || {}; };
    var cap = function (who) { return who === 'Noor' ? 40 : D.people[who]; };
    var deptPeople = function (dept) { var o = []; T.forEach(function (t) { if (t.dept === dept && o.indexOf(t.owner) < 0) o.push(t.owner); }); return o; };
    var depts = Object.keys(DEPT).map(function (name) {
      var ts = all.concat(masterTasks).filter(function (t) { return t.dept === name; });
      var open = ts.filter(function (t) { return t.st !== 'done'; });
      var inSubs = []; open.forEach(function (t) { var n = subTitle[t.sub]; if (inSubs.indexOf(n) < 0) inSubs.push(n); });
      var next = open.slice().sort(function (a, b) { return a.end < b.end ? -1 : 1; })[0];
      var ppl = deptPeople(name).map(function (p) {
        var hw = hours(p);
        var full = weeks.filter(function (wk) { return (hw[wk] || 0) >= cap(p) - 0.5; }).length;
        return { name: NAME[p], cap: cap(p) + ' h/week', full: full, fullLabel: full ? 'Fully booked ' + full + ' of ' + weeks.length + ' weeks' : 'Has room',
          fullStyle: chipBase + (full >= 6 ? 'color: #991B1B; background: #FEE2E2;' : full ? 'color: #9A3412; background: #FFEDD5;' : 'color: #115E59; background: #CCFBF1;'),
          cells: weeks.map(function (wk) { var h = hw[wk] || 0; var r = h / cap(p); return { title: fmtWeek(wk) + ': ' + Math.round(h) + ' of ' + cap(p) + ' h', text: h ? Math.round(h) : '', style: 'height: 30px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; ' + (h === 0 ? 'background: #F1F5F9; color: #94A3B8;' : r >= 0.99 ? 'background: #FEE2E2; color: #991B1B; outline: 2px solid #DC2626; outline-offset: -2px;' : r > 0.6 ? 'background: #DBEAFE; color: #1E3A8A;' : 'background: #EFF6FF; color: #1E40AF;') }; }) };
      });
      var anyFull = ppl.some(function (p) { return p.full >= 6; });
      return { name: name, chip: deptChip(name), contact: DEPT[name].who + ' · ' + DEPT[name].role, count: open.length, countLabel: open.length ? open.length + ' open task' + (open.length === 1 ? '' : 's') : 'Nothing open', where: inSubs.length ? 'in ' + inSubs.join(', ') : '', next: next ? 'Next: ' + next.title + ', due ' + fmt(next.end) : 'All done', people: ppl, warn: anyFull, warnLabel: anyFull ? 'Overloaded' : 'OK',
        warnStyle: chipBase + (anyFull ? 'color: #991B1B; background: #FEE2E2;' : 'color: #115E59; background: #CCFBF1;'),
        selected: st.dept === name, pick: go({ dept: st.dept === name ? null : name }),
        tasks: open.sort(function (a, b) { return a.end < b.end ? -1 : 1; }).map(function (t) { return { title: t.title, where: subTitle[t.sub], who: NAME[t.owner], due: fmt(t.end), st: t.st === 'doing' ? 'Doing' : 'To do' }; }) };
    });
    function fmtWeek(wk) { return 'Week of ' + fmt(wk); }
    var weekHead = weeks.map(function (wk) { return { label: fmt(wk) }; });

    // Combined timeline: one bar per sub-plan; expand for tasks. Day scale from Mar 1 to May 7.
    var t0 = ms('2027-03-01'), t1 = ms('2027-05-08'), span = t1 - t0;
    var X = function (iso) { return ((ms(iso) - t0) / span * 100).toFixed(2) + '%'; };
    var W = function (a, b) { return (((ms(b) + DAY) - ms(a)) / span * 100).toFixed(2) + '%'; };
    var rows = [{ key: 'master', title: 'Whole building', tasks: masterTasks }].concat(subs.map(function (s) { return { key: s.key, title: s.title, tasks: T.filter(function (t) { return t.sub === s.key; }) }; })).map(function (r) {
      var start = r.tasks.map(function (t) { return t.start; }).sort()[0], end = r.tasks.map(function (t) { return t.end; }).sort().slice(-1)[0];
      var crit = r.tasks.some(function (t) { return t.critical; });
      var open = !!st.open[r.key];
      var tog = {}; tog[r.key] = !open;
      var links = [];
      if (r.key !== 'master') r.tasks.forEach(function (t) { t.deps.forEach(function (d) { var o = byId[d]; if (o && o.sub !== r.key && o.sub !== 'master' && links.indexOf(o.title) < 0) links.push(o.title); }); });
      return { title: r.title, when: fmt(start) + ' to ' + fmt(end), open: open, toggle: function () { self.setState({ open: Object.assign({}, st.open, tog) }); }, arrow: open ? '▾' : '▸', links: links.length ? 'waits on ' + links.join(', ') : '',
        bar: 'position: absolute; top: 9px; height: 18px; border-radius: 5px; left: ' + X(start) + '; width: ' + W(start, end) + '; background: ' + (crit ? '#4F46E5' : '#A5B4FC') + ';',
        tasks: r.tasks.map(function (t) { var x = DEPT[t.dept]; return { title: t.title, who: NAME[t.owner], dept: t.dept, dates: fmt(t.start) + (t.start === t.end ? '' : ' to ' + fmt(t.end)), why: t.why.replace(/T\d+ "/g, '"'),
          bar: 'position: absolute; top: 7px; height: 14px; border-radius: 4px; left: ' + X(t.start) + '; width: ' + W(t.start, t.end) + '; background: ' + x.c + ';' + (t.critical ? ' box-shadow: 0 0 0 2px #0F172A;' : ''), chip: deptChip(t.dept), crit: t.critical }; }) };
    });
    var todayLine = 'position: absolute; top: 0; bottom: 0; width: 2px; background: #DC2626; left: ' + X(today) + ';';
    var targetLine = 'position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px dashed #0F172A; left: ' + X(TARGET.master) + ';';
    var axis = [];
    for (var a = t0; a < t1; a += 7 * DAY) axis.push({ label: fmt(new Date(a).toISOString().slice(0, 10)), style: 'position: absolute; top: 0; font-size: 11px; color: #64748B; left: ' + ((a - t0) / span * 100).toFixed(2) + '%;' });

    // Comments and discussion. Sample messages as of the sample's "today" (Mar 8); every date they mention is the engine's.
    // The viewer is Dana Reyes (Facilities lead). Messages from others posted today are unread.
    var ME = 'Dana';
    var geom = typeof IS_PHONE !== 'undefined' && IS_PHONE ? { task: [40, 7.6], thread: [40, 7.6] } : { task: [40, 7.4], thread: [128, 7.4] };
    var PDEPT = { Kai: 'Facilities', Leo: 'Facilities', Rosa: 'Facilities', Dana: 'Facilities', Noor: 'Facilities', Ivan: 'IT', Mei: 'HR', Omar: 'Finance', Tess: 'Safety' };
    var BYNAME = {}; Object.keys(NAME).forEach(function (k) { BYNAME[NAME[k]] = k; });
    var COMMENTS = [
      { task: 'T4', who: 'Ivan', at: '2027-03-05T14:20', text: 'The new closet is the old storage room behind reception. @Dana Reyes can Facilities clear it by Mar 10?' },
      { task: 'T4', who: 'Dana', at: '2027-03-05T15:02', text: 'Yes, it will be empty by Mar 9. The front desk comes out Mar 8 to 10, so you can start Mar 10.' },
      { task: 'T33', who: 'Ivan', at: '2027-03-08T10:05', text: 'This waits on the closet move in Reception (done Mar 18). @Mei Chen can I get a rough desk layout by Apr 14?' },
      { task: 'T33', who: 'Mei', at: '2027-03-08T11:30', text: 'Yes. The full seating plan is due Apr 28, but you will have a rough layout by Apr 14.' },
      { task: 'T35', who: 'Mei', at: '2027-03-08T11:32', text: 'Starting from last year\'s sales seating. @Dana Reyes are we keeping the standing desks?' },
      { task: 'T32', who: 'Kai', at: '2027-03-04T08:15', text: 'Same light gray as Office 1. I am ordering both rooms\' paint together.' },
      { task: 'T12', who: 'Kai', at: '2027-03-08T07:50', text: 'Done by noon today. @Rosa Diaz the sink plumbing can start this afternoon.' },
      { task: 'T14', who: 'Omar', at: '2027-03-04T16:40', text: 'Appliances are ordered and arrive before the cabinets go in on Mar 16.' },
      { task: 'T24', who: 'Mei', at: '2027-03-03T10:00', text: '@Rosa Diaz the accessible stall needs its drain on the left wall. I will approve the layout by Mar 22.' }
    ].concat(st.posted);
    var THREADS = [
      { thread: 'master', who: 'Tess', at: '2027-03-01T16:10', about: 'T2', text: 'Asbestos survey is clear. The report is attached to the task.' },
      { thread: 'master', who: 'Dana', at: '2027-03-03T12:00', about: 'T1', text: 'Permits approved. Every room can start.' },
      { thread: 'master', who: 'Mei', at: '2027-03-08T09:10', about: 'T6', text: 'Move-in shows May 6 and our target is Apr 30. @Dana Reyes what would get us back on time?' },
      { thread: 'reception', who: 'Ivan', at: '2027-03-05T14:25', about: 'T4', text: 'Heads up for Offices 1 to 3: your network cabling waits on the closet move here, Mar 10 to 18. I will post here when it is done.' },
      { thread: 'reception', who: 'Kai', at: '2027-03-08T07:40', about: 'T7', text: 'Front desk demolition starts today and is done Mar 10.' },
      { thread: 'kitchen', who: 'Omar', at: '2027-03-04T16:42', about: 'T11', text: 'Appliances ordered, within the approved budget.' },
      { thread: 'kitchen', who: 'Rosa', at: '2027-03-08T12:15', about: 'T13', text: 'Sink and dishwasher plumbing under way, done Mar 12.' },
      { thread: 'bathroom-2', who: 'Mei', at: '2027-03-03T10:05', about: 'T24', text: 'The accessible stall layout gets approved Mar 17 to 22, after the room is stripped.' },
      { thread: 'office-2', who: 'Mei', at: '2027-03-08T11:35', about: 'T35', text: 'The sales team moves in here. IT gets a rough desk layout by Apr 14 for the cabling; the full seating plan follows Apr 28.' }
    ].concat(st.tposted);
    var fmtAt = function (at) { var h = +at.slice(11, 13), m = at.slice(14, 16); return fmt(at.slice(0, 10)) + ', ' + ((h + 11) % 12 + 1) + ':' + m + (h < 12 ? ' AM' : ' PM'); };
    var MENTION = new RegExp('(@(?:' + Object.keys(BYNAME).join('|') + '))');
    var segs = function (text) { return text.split(MENTION).filter(function (x) { return x; }).map(function (x) { return { t: x, style: MENTION.test(x) && x.charAt(0) === '@' ? 'font-weight: 600; color: #3730A3; background: #EEF2FF; border-radius: 4px; padding: 0 2px;' : '' }; }); };
    var unread = function (m) { return m.who !== ME && m.at.slice(0, 10) === today && !m.mine; };
    var msgView = function (m) { return { who: NAME[m.who], dept: deptChip(PDEPT[m.who]), when: fmtAt(m.at), segs: segs(m.text), mine: m.who === ME }; };
    var commentsOf = function (id) { return COMMENTS.filter(function (c) { return c.task === id; }); };
    // "@na" being typed at the end, as in the app's comment box.
    var typing = function (text) { var m = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(text); return m ? m[1] : null; };
    // @mention autocomplete at the cursor: a small menu opens where the @ is typed, filtered as you type.
    // Arrow keys move, Enter or Tab fills in the name, Escape closes it. geom = [columns per line, px per character].
    var ROLE = function (n) { var k = BYNAME[n]; return PDEPT[k] + (DEPT[PDEPT[k]].who === n ? ' lead' : ''); };
    var suggest = function (text, pool, key, geom) {
      var part = typing(text), idxKey = key + 'Idx', offKey = key + 'Off';
      var list = part === null || st[offKey] === text ? [] : pool.filter(function (n) { return n !== NAME[ME] && n.toLowerCase().indexOf(part.toLowerCase()) === 0 && n.toLowerCase() !== part.toLowerCase(); }).slice(0, 5);
      var idx = Math.min(st[idxKey] || 0, Math.max(list.length - 1, 0));
      var fill = function (n) { var o = {}; o[key] = text.replace(/@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/, '@' + n + ' '); o[idxKey] = 0; self.setState(o); };
      // Where the @ sits: count wrapped lines up to the cursor (the end of the text in this mockup).
      var at = text.lastIndexOf('@'), before = text.slice(0, at), rows = 0, col = 0;
      before.split('\n').forEach(function (ln, i, arr) { var wraps = Math.floor(ln.length / geom[0]); if (i < arr.length - 1) rows += wraps + 1; else { rows += wraps; col = ln.length % geom[0]; } });
      var left = Math.min(10 + col * geom[1], geom[0] * geom[1] - 200);
      return {
        list: list.map(function (n, i) { return { name: n, role: ROLE(n), sel: i === idx ? 'true' : 'false', pick: function () { fill(n); },
          style: 'display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; min-height: 44px; justify-content: center; padding: 4px 10px; border: none; border-radius: 8px; cursor: pointer; text-align: left; font-family: Inter, sans-serif; color: #0F172A; background: ' + (i === idx ? '#EEF2FF' : '#FFFFFF') + ';' }; }),
        open: list.length > 0,
        box: 'position: absolute; z-index: 5; top: ' + (8 + (rows + 1) * 21) + 'px; left: ' + Math.max(left, 4) + 'px; width: 220px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 12px; box-shadow: 0 8px 24px rgba(15,23,42,0.16); padding: 4px; display: flex; flex-direction: column; gap: 2px;',
        onKey: function (e) {
          if (!list.length) return;
          var o = {};
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); o[idxKey] = (idx + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; self.setState(o); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); fill(list[idx]); }
          else if (e.key === 'Escape') { e.preventDefault(); o[offKey] = text; self.setState(o); }
        }
      };
    };
    var mentionsMe = COMMENTS.concat(THREADS).filter(function (m) { return unread(m) && m.text.indexOf('@' + NAME[ME]) >= 0 && !(m.thread && st.read[m.thread]); }).length;

    // The open sub-plan (inside the master).
    var cur = subs.filter(function (s) { return s.key === st.sub; })[0] || subs[0];
    var curTasks = T.filter(function (t) { return t.sub === cur.key; }).map(function (t) {
      var ext = t.deps.map(function (d) { return byId[d]; }).filter(function (o) { return o && o.sub !== cur.key; });
      var STS = { done: ['Done', 'color: #115E59; background: #CCFBF1;'], doing: ['Doing', 'color: #3730A3; background: #EEF2FF;'], todo: ['To do', 'color: #334155; background: #F1F5F9;'] }[t.st];
      var n = commentsOf(t.id).length, on = st.task === t.id;
      return { id: t.id, open: go({ task: on ? null : t.id, draft: '' }), on: on ? 'true' : 'false', rowStyle: 'border: none; border-top: 1px solid #E2E8F0; padding: 10px 8px; margin: 0 -8px; display: flex; gap: 12px; align-items: flex-start; text-align: left; cursor: pointer; font-family: Inter, sans-serif; color: #0F172A; border-radius: 10px; background: ' + (on ? '#EEF2FF' : 'transparent') + ';',
        comments: n ? n + ' comment' + (n === 1 ? '' : 's') : '', title: t.title, who: NAME[t.owner], dates: fmt(t.start) + (t.start === t.end ? '' : ' to ' + fmt(t.end)), chip: deptChip(t.dept), status: STS[0], statusStyle: chipBase + STS[1], ext: ext.map(function (o) { return 'Waits on ' + subTitle[o.sub] + ': ' + o.title + (o.st === 'done' ? ' (done)' : ', ' + fmt(o.end)); }), hasExt: ext.length > 0, why: t.why.replace(/T\d+ "/g, '"') };
    });
    var curDepts = [cur.lead].concat(cur.needs).map(function (c) { return { chip: c, contact: DEPT[c.name].who + ' · ' + DEPT[c.name].role }; });

    // The open task's comment thread (same parts as the app's task sheet).
    var planPeople = []; T.forEach(function (t) { if (t.sub === cur.key && planPeople.indexOf(NAME[t.owner]) < 0) planPeople.push(NAME[t.owner]); });
    curDepts.forEach(function (d) { var w = DEPT[d.chip.name].who; if (planPeople.indexOf(w) < 0) planPeople.push(w); });
    var openTask = st.task && byId[st.task] && byId[st.task].sub === cur.key ? curTasks.filter(function (t) { return t.id === st.task; })[0] : false;
    var taskView = openTask ? Object.assign({}, openTask, {
      comments: commentsOf(openTask.id).map(msgView), count: commentsOf(openTask.id).length, none: commentsOf(openTask.id).length === 0,
      draft: st.draft, onDraft: function (e) { self.setState({ draft: e.target.value }); },
      mention: suggest(st.draft, planPeople, 'draft', geom.task), placeholder: 'Ask or note something about ' + openTask.title + '. Type @ to mention someone.',
      post: function () { if (!st.draft.trim()) return; self.setState({ posted: st.posted.concat([{ task: openTask.id, who: ME, at: today + 'T13:00', text: st.draft.trim(), mine: true }]), draft: '' }); },
      close: go({ task: null }), who2: 'People on this plan and its departments\' contacts can be mentioned.'
    }) : false;

    // Discussion: one thread per plan plus the whole building.
    var threadKeys = ['master'].concat(subs.map(function (s) { return s.key; }));
    var threadList = threadKeys.map(function (k) {
      var ms2 = THREADS.filter(function (m) { return m.thread === k; });
      var last = ms2.slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; }).slice(-1)[0];
      var nNew = st.read[k] ? 0 : ms2.filter(unread).length, on = st.thread === k;
      return { key: k, title: subTitle[k], last: last ? NAME[last.who] + ': ' + last.text : 'No messages yet.', when: last ? fmtAt(last.at) : '', nNew: nNew, newLabel: nNew ? nNew + ' new' : '',
        pick: function () { var r = Object.assign({}, st.read); r[k] = true; self.setState({ thread: k, read: r, tdraft: '', threadOpen: true }); }, on: on ? 'true' : 'false',
        style: 'border: none; border-top: 1px solid #E2E8F0; padding: 10px; text-align: left; cursor: pointer; font-family: Inter, sans-serif; color: #0F172A; display: flex; flex-direction: column; gap: 3px; min-height: 44px; border-radius: 10px; background: ' + (on ? '#EEF2FF' : 'transparent') + ';' };
    });
    var newTotal = threadList.reduce(function (a, t) { return a + t.nNew; }, 0);
    var thDepts = st.thread === 'master' ? Object.keys(DEPT) : (function () { var s0 = D.subs.filter(function (x) { return x.key === st.thread; })[0]; return [s0.lead].concat(s0.needs); })();
    var thPeople = []; T.forEach(function (t) { if ((st.thread === 'master' || t.sub === st.thread) && thPeople.indexOf(NAME[t.owner]) < 0) thPeople.push(NAME[t.owner]); });
    thDepts.forEach(function (d) { if (thPeople.indexOf(DEPT[d].who) < 0) thPeople.push(DEPT[d].who); });
    var thread = {
      title: subTitle[st.thread], who: st.thread === 'master' ? 'Everyone on any plan in the remodel reads this thread.' : 'Everyone on ' + subTitle[st.thread] + ' reads this thread, plus the departments it needs.',
      depts: thDepts.map(deptChip),
      msgs: THREADS.filter(function (m) { return m.thread === st.thread; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (m) {
        var t = m.about && byId[m.about];
        return Object.assign(msgView(m), { about: t ? 'About: ' + t.title + ' (' + subTitle[t.sub] + ')' : '', hasAbout: !!t,
          openAbout: t ? (t.sub === 'master' ? go({ view: 'timeline' }) : go({ view: 'plan', sub: t.sub, task: t.id, draft: '' })) : null });
      }),
      draft: st.tdraft, onDraft: function (e) { self.setState({ tdraft: e.target.value }); }, mention: suggest(st.tdraft, thPeople, 'tdraft', geom.thread),
      placeholder: 'Write to everyone on ' + subTitle[st.thread] + '. Type @ to mention someone.',
      post: function () { if (!st.tdraft.trim()) return; self.setState({ tposted: st.tposted.concat([{ thread: st.thread, who: ME, at: today + 'T13:00', text: st.tdraft.trim(), mine: true }]), tdraft: '' }); }
    };
    thread.none = thread.msgs.length === 0;
    thread.back = go({ threadOpen: false });

    // Activity across all plans, written by the server for every change; filter by plan and department.
    var acts = [];
    T.forEach(function (t) {
      if (t.st === 'done') acts.push({ at: t.end + 'T16:30', who: t.owner, what: 'marked ' + t.title + ' done', sub: t.sub, dept: t.dept });
      if (t.st !== 'todo') acts.push({ at: t.start + 'T08:00', who: t.owner, what: 'started ' + t.title, sub: t.sub, dept: t.dept });
    });
    COMMENTS.forEach(function (c) { var t = byId[c.task]; acts.push({ at: c.at, who: c.who, what: 'commented on ' + t.title, sub: t.sub, dept: PDEPT[c.who] }); });
    THREADS.forEach(function (m) { acts.push({ at: m.at, who: m.who, what: 'posted in the ' + subTitle[m.thread] + ' discussion', sub: m.thread, dept: PDEPT[m.who] }); });
    var actShown = acts.filter(function (a) { return (st.actPlan === 'all' || a.sub === st.actPlan) && (st.actDept === 'all' || a.dept === st.actDept); })
      .sort(function (a, b) { return a.at > b.at ? -1 : 1; })
      .map(function (a) { return { who: NAME[a.who], what: a.what, where: subTitle[a.sub], dept: deptChip(a.dept), when: fmtAt(a.at) }; });
    var pill = function (on) { return chipBase + 'min-height: 36px; padding: 0 12px; cursor: pointer; font-family: Inter, sans-serif; ' + (on ? 'border: 2px solid #0F172A; background: #FFFFFF; color: #0F172A;' : 'border: 1px solid #E2E8F0; background: #FFFFFF; color: #475569;'); };
    var actPlans = [{ key: 'all', label: 'All plans' }].concat(threadKeys.map(function (k) { return { key: k, label: subTitle[k] }; })).map(function (p) { var on = st.actPlan === p.key; return { label: p.label, on: on ? 'true' : 'false', pick: go({ actPlan: p.key }), style: pill(on) }; });
    var actDepts = [{ key: 'all', label: 'All departments' }].concat(Object.keys(DEPT).map(function (k) { return { key: k, label: k }; })).map(function (p) { var on = st.actDept === p.key; return { label: p.label, on: on ? 'true' : 'false', pick: go({ actDept: p.key }), style: pill(on) }; });

    var tabs = [['overview', 'Overview'], ['timeline', 'Timeline'], ['departments', 'Departments'], ['plan', 'Inside a plan'], ['discussion', newTotal ? 'Discussion · ' + newTotal + ' new' : 'Discussion'], ['activity', 'Activity']].map(function (t) {
      var on = st.view === t[0];
      var o = { view: t[0] }; if (t[0] === 'discussion') { o.read = Object.assign({}, st.read); o.read[st.thread] = true; }
      return { label: t[1], on: on ? 'page' : 'false', pick: go(o), style: 'min-height: 44px; padding: 0 16px; border: none; background: transparent; cursor: pointer; font: 600 15px Inter, sans-serif; border-bottom: 3px solid ' + (on ? '#4F46E5' : 'transparent') + '; color: ' + (on ? '#0F172A' : '#475569') + ';' };
    });
    var scenarios = [
      { key: 'none', label: 'As planned', hint: 'Move-in ' + fmt(D.finish) },
      { key: 'noor', label: 'Add a second carpenter for the bathroom tiling', hint: 'Noor Aziz, 40 h/week: move-in ' + fmt(D.whatIfNoor.finish) },
      { key: 'cabinets', label: 'Kitchen cabinets take 3 days longer', hint: 'Move-in ' + fmt(D.whatIfCabinets.finish) }
    ].map(function (s) { var on = st.whatIf === s.key; return { label: s.label, hint: s.hint, on: on ? 'true' : 'false', pick: go({ whatIf: s.key }), style: 'display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; min-height: 44px; border-radius: 12px; cursor: pointer; text-align: left; font-family: Inter, sans-serif; color: #0F172A; ' + (on ? 'border: 2px solid #4F46E5; background: #EEF2FF;' : 'border: 1px solid #E2E8F0; background: #FFFFFF;') }; });

    var kaiFull = depts.filter(function (d) { return d.name === 'Facilities'; })[0].people.filter(function (p) { return p.name === 'Kai Brooks'; })[0];
    var insight = st.whatIf === 'noor'
      ? 'With Noor Aziz tiling Bathrooms 1 to 3, Kai Brooks is freed for the offices: move-in moves from ' + fmt(D.finish) + ' to ' + fmt(D.whatIfNoor.finish) + ', ' + lateDays(D.finish, D.whatIfNoor.finish) + ' working days earlier and inside the Apr 30 target.'
      : st.whatIf === 'cabinets'
        ? 'Kitchen cabinets 3 days longer: Kai Brooks starts every later room 3 days later, so move-in moves from ' + fmt(D.finish) + ' to ' + fmt(D.whatIfCabinets.finish) + '.'
        : 'Kai Brooks (carpenter) is on 6 of the 8 rooms and ' + kaiFull.fullLabel.toLowerCase() + '. Every room waits for Kai, so Kai decides move-in. A second carpenter for the bathroom tiling would move it to ' + fmt(D.whatIfNoor.finish) + '.';

    var blockers = [];
    T.forEach(function (t) { t.deps.forEach(function (d) { var o = byId[d]; if (o && o.sub !== t.sub && o.st !== 'done' && t.sub !== 'master') blockers.push({ what: o.title, where: subTitle[o.sub], who: NAME[o.owner], dept: deptChip(o.dept), due: fmt(o.end), waiting: subTitle[t.sub] }); }); });
    var grouped = {};
    blockers.forEach(function (b) { var k = b.what; (grouped[k] = grouped[k] || Object.assign({}, b, { waiting: [] })).waiting.push(b.waiting); });
    var blockerList = Object.keys(grouped).map(function (k) { var g = grouped[k]; var uniq = g.waiting.filter(function (x, i) { return g.waiting.indexOf(x) === i; }); return Object.assign({}, g, { waitingLabel: uniq.length + ' plan' + (uniq.length === 1 ? '' : 's') + ' wait: ' + uniq.join(', ') }); });

    return {
      isOverview: st.view === 'overview', isTimeline: st.view === 'timeline', isDepts: st.view === 'departments', isPlan: st.view === 'plan', isDiscussion: st.view === 'discussion', isActivity: st.view === 'activity',
      task: taskView, noTask: !taskView, threadOpen: !!st.threadOpen, threadClosed: !st.threadOpen, threads: threadList, thread: thread, acts: actShown, actNone: actShown.length === 0, actCount: actShown.length + ' change' + (actShown.length === 1 ? '' : 's'), actPlans: actPlans, actDepts: actDepts,
      bell: mentionsMe ? 'Notifications · ' + mentionsMe : 'Notifications', bellLabel: mentionsMe ? mentionsMe + ' new mentions' : 'No new notifications', me: NAME[ME] + ', ' + DEPT.Facilities.role,
      tabs: tabs, title: 'Northfield HQ remodel', sub: 'Master plan · 8 plans inside · Facilities leads, with IT, HR, Finance and Safety',
      kpis: [
        { k: 'Done', v: pctAll + '%', s: T.filter(function (t) { return t.st === 'done'; }).length + ' of ' + T.length + ' tasks across all plans' },
        { k: 'Move-in', v: fmt(moveIn.end), s: moveIn.end <= TARGET.master ? 'Target Apr 30: on time' : 'Target Apr 30: ' + lateDays(moveIn.end, TARGET.master) + ' working days late' },
        { k: 'Plans at risk', v: String(lateSubs.length) + ' of ' + subs.length, s: lateSubs.length ? lateSubs.map(function (s) { return s.title; }).join(', ') : 'All plans on track' },
        { k: 'Waiting across plans', v: String(blockerList.length), s: blockerList.map(function (b) { return b.what; }).join(', ') || 'Nothing' }
      ],
      masterHealth: hMaster.label + (hMaster.n ? ' · ' + hMaster.n + 'd late' : ''), masterHealthStyle: chipBase + hMaster.style,
      insight: insight, scenarios: scenarios, milestones: milestones, subs: subs, blockers: blockerList,
      depts: depts, weekHead: weekHead, deptSel: depts.filter(function (d) { return d.selected; })[0] || false,
      rows: rows, axis: axis, todayLine: todayLine, targetLine: targetLine,
      cur: cur, curTasks: curTasks, curDepts: curDepts, subPicks: subs.map(function (s) { var on = s.key === cur.key; return { label: s.title, pick: go({ sub: s.key, task: null }), style: chipBase + 'min-height: 36px; padding: 0 12px; cursor: pointer; font-family: Inter, sans-serif; ' + (on ? 'border: 2px solid #0F172A; background: #FFFFFF; color: #0F172A;' : 'border: 1px solid #E2E8F0; background: #FFFFFF; color: #475569;') }; }),
      back: go({ view: 'overview' }),
      deptLegend: Object.keys(DEPT).map(deptChip)
    };
  }
}
