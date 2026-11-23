class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { view: 'overview', sub: 'office-2', open: {}, whatIf: 'none', dept: null };
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
        people: people.map(function (p) { return NAME[p]; }).join(', '), open: go({ view: 'plan', sub: s.key }), late: h.label !== 'On track' };
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

    // The open sub-plan (inside the master).
    var cur = subs.filter(function (s) { return s.key === st.sub; })[0] || subs[0];
    var curTasks = T.filter(function (t) { return t.sub === cur.key; }).map(function (t) {
      var ext = t.deps.map(function (d) { return byId[d]; }).filter(function (o) { return o && o.sub !== cur.key; });
      var STS = { done: ['Done', 'color: #115E59; background: #CCFBF1;'], doing: ['Doing', 'color: #3730A3; background: #EEF2FF;'], todo: ['To do', 'color: #334155; background: #F1F5F9;'] }[t.st];
      return { title: t.title, who: NAME[t.owner], dates: fmt(t.start) + (t.start === t.end ? '' : ' to ' + fmt(t.end)), chip: deptChip(t.dept), status: STS[0], statusStyle: chipBase + STS[1], ext: ext.map(function (o) { return 'Waits on ' + subTitle[o.sub] + ': ' + o.title + (o.st === 'done' ? ' (done)' : ', ' + fmt(o.end)); }), hasExt: ext.length > 0, why: t.why.replace(/T\d+ "/g, '"') };
    });
    var curDepts = [cur.lead].concat(cur.needs).map(function (c) { return { chip: c, contact: DEPT[c.name].who + ' · ' + DEPT[c.name].role }; });

    var tabs = [['overview', 'Overview'], ['timeline', 'Timeline'], ['departments', 'Departments'], ['plan', 'Inside a plan']].map(function (t) {
      var on = st.view === t[0];
      return { label: t[1], on: on ? 'page' : 'false', pick: go({ view: t[0] }), style: 'min-height: 44px; padding: 0 16px; border: none; background: transparent; cursor: pointer; font: 600 15px Inter, sans-serif; border-bottom: 3px solid ' + (on ? '#4F46E5' : 'transparent') + '; color: ' + (on ? '#0F172A' : '#475569') + ';' };
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
      isOverview: st.view === 'overview', isTimeline: st.view === 'timeline', isDepts: st.view === 'departments', isPlan: st.view === 'plan',
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
      cur: cur, curTasks: curTasks, curDepts: curDepts, subPicks: subs.map(function (s) { var on = s.key === cur.key; return { label: s.title, pick: go({ sub: s.key }), style: chipBase + 'min-height: 36px; padding: 0 12px; cursor: pointer; font-family: Inter, sans-serif; ' + (on ? 'border: 2px solid #0F172A; background: #FFFFFF; color: #0F172A;' : 'border: 1px solid #E2E8F0; background: #FFFFFF; color: #475569;') }; }),
      back: go({ view: 'overview' }),
      deptLegend: Object.keys(DEPT).map(deptChip)
    };
  }
}
