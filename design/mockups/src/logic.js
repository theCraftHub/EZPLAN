class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = Object.assign({ q: '', person: null, confirming: false, notice: '', menu: false, addOpen: false, addMode: 'one', addStep: 'form', addEmail: 'nia.brooks@northfield.example', addRole: 'Editor', addWs: 'Field Ops', added: [], deactivated: {}, signedOut: {} }, { tab: 'overview', filter: 'Field Ops', sel: {}, all: false, moveOpen: false, moved: false, undo: false, step: 0, guestFixed: false, synced: false }, { peopleDone: false, handoff: false, pol: { links: 'approval', guests: 90, week: '40', ai: 'on' }, draft: {}, saved: {}, audit: 'All', siem: 'Splunk', reclaim: false });
  }
  renderVals() {
    var self = this;
    var st = this.state;
    var items = [
      ['overview', 'Overview', null, 'Manage'], ['people', 'People', null, null], ['off', 'Offboarding', '1', null], ['groups', 'Groups and access', null, null],
      ['setup', 'Setup', null, 'Security and billing'], ['policies', 'Policies', null, null], ['audit', 'Audit log', null, null], ['licenses', 'Licenses and billing', null, null], ['spending', 'AI spending', null, null]
    ];
    var nav = items.map(function (n) {
      var on = st.tab === n[0];
      return { label: n[1], badge: n[2] || false, heading: n[3] || false, current: on ? 'page' : 'false', pick: function () { self.setState({ tab: n[0] }); },
        style: 'min-height: 42px; padding: 0 12px; border-radius: 10px; border: none; display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; font: ' + (on ? '600' : '500') + ' 14px Inter, sans-serif; ' + (on ? 'background: #1E293B; color: #FFFFFF;' : 'background: transparent; color: #CBD5E1;') };
    });
    var cur = items.filter(function (n) { return n[0] === st.tab; })[0];
    var menu = items.map(function (n) {
      var on = st.tab === n[0];
      return { label: n[1], badge: n[2] || false, heading: n[3] || false, current: on ? 'page' : 'false', pick: function () { self.setState({ tab: n[0], menu: false, person: null }); },
        style: 'min-height: 52px; padding: 0 14px; border-radius: 12px; border: none; display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; font: ' + (on ? '700' : '600') + ' 16px Inter, sans-serif; ' + (on ? 'background: #EEF2FF; color: #1E1B4B;' : 'background: transparent; color: #0F172A;') };
    });
    return Object.assign({}, this.manageVals(), this.securityVals(), this.extraVals(), this.spendVals(), { nav: nav, menu: menu, sectionTitle: cur ? cur[1] : '', menuOpen: st.menu, openMenu: function () { self.setState({ menu: true }); }, closeMenu: function () { self.setState({ menu: false }); } });
  }
  manageVals() {
    var self = this;
    var st = this.state;

    // ---- overview
    var kpis = [
      { label: 'Seats', value: '184 of 200', note: '9 people inactive for 60+ days', action: 'Review seat reclaim', act: function () { self.setState({ tab: 'licenses' }); } },
      { label: 'Directory sync', value: 'Healthy', note: 'Microsoft Entra ID · 12 minutes ago', action: false, act: null },
      { label: 'Sign-in', value: 'Microsoft only', note: 'Required for everyone on northfield.example', action: false, act: null },
      { label: 'Plans', value: '61 active', note: '14 finished this quarter', action: false, act: null }
    ];
    var items = [
      ['Domain northfield.example verified', true],
      ['Everyone signs in with Microsoft', true],
      ['Directory sync is on', true],
      ['Guests expire after 90 days', st.guestFixed],
      ['Public share links need approval', true],
      ['At least 2 admins', true],
      ['Admins use multi-factor sign-in (from Microsoft)', true]
    ];
    var done = items.filter(function (i) { return i[1]; }).length;
    var checklist = items.map(function (i) {
      return { label: i[0], icon: i[1] ? '✓' : '!', state: i[1] ? 'Done' : 'Not yet', fix: !i[1], doFix: function () { self.setState({ guestFixed: true }); },
        iconStyle: 'width: 24px; height: 24px; border-radius: 12px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; ' + (i[1] ? 'background: #CCFBF1; color: #115E59;' : 'background: #FFEDD5; color: #9A3412;'),
        stateStyle: 'font-size: 12px; font-weight: 700; ' + (i[1] ? 'color: #115E59;' : 'color: #9A3412;') };
    });
    var alerts = [
      { title: '5 failed sign-ins', body: 'luis.park@northfield.example, yesterday 17:55, from 203.0.113.7. Guest on Kitchen Remodel.', action: 'Review Luis Park', act: function () { self.setState({ tab: 'people', filter: 'All', person: 'Luis Park', confirming: false }); } },
      { title: '16 seats left', body: 'Sync adds new hires automatically. Turn on "add seats automatically" or buy more before you run out.', action: 'Manage seats', act: function () { self.setState({ tab: 'licenses' }); } },
      { title: '2 invites not accepted', body: 'Sent 5 days ago to Ivy Chen and Noah Diaz. They can\'t sign in until they do.', action: 'See invites', act: function () { self.setState({ tab: 'people', filter: 'Invited' }); } },
      { title: '1 person to offboard', body: 'Marcus Reyes was disabled in Entra today and still owns 3 plans.', action: 'Start', act: function () { self.setState({ tab: 'off', step: 0 }); } }
    ];
    var adoption = [['Field Ops', 92], ['Estimating', 88], ['Office', 71], ['Safety', 64]].map(function (d) {
      return { dept: d[0], text: d[1] + '% active', bar: 'width: ' + d[1] + '%; background: #4F46E5;' };
    });

    // ---- people
    var people = [
      ['Ana Lima', 'Field Ops', 'Field Ops', 'Manager', 'Today', 'Active'],
      ['Dana Okafor', 'Field Ops', 'Field Ops North', 'Editor', 'Today', 'Active'],
      ['Jun Watanabe', 'Field Ops', 'Field Ops', 'Editor', 'Yesterday', 'Active'],
      ['Luis Park', 'Field Ops', 'Kitchen Remodel (guest)', 'Guest', '3 days ago', 'Guest · expires Feb 2'],
      ['Mira Haddad', 'Field Ops', 'Field Ops', 'Editor', 'Today', 'Active'],
      ['Omar Sayed', 'Field Ops', 'Field Ops', 'Editor', '2 days ago', 'Active'],
      ['Priya Raman', 'Field Ops', 'Field Ops', 'Viewer', '71 days ago', 'Inactive 60+ days'],
      ['Tess Nguyen', 'Field Ops', 'Field Ops', 'Editor', 'Today', 'Active'],
      ['Marcus Reyes', 'Estimating', 'Estimating', 'Editor', 'Today', 'Disabled in Entra'],
      ['Hana Kim', 'Estimating', 'Estimating', 'Manager', 'Today', 'Active'],
      ['Ravi Shah', 'Office', 'Office', 'Editor', '64 days ago', 'Inactive 60+ days'],
      ['Sofia Costa', 'Safety', 'Safety', 'Editor', 'Today', 'Active'],
      ['Ivy Chen', 'Office', 'Office', 'Editor', 'Not signed in yet', 'Invited · 5 days ago'],
      ['Noah Diaz', 'Field Ops', 'Field Ops', 'Editor', 'Not signed in yet', 'Invited · 5 days ago']
    ].concat(st.added.map(function (a) { return [a.name, a.dept, a.ws, a.role, 'Not signed in yet', a.status]; })).map(function (p) {
      if (st.deactivated[p[0]]) return [p[0], p[1], p[2], p[3], p[4], 'Deactivated · undo until midnight'];
      return p;
    });
    var shown = people.filter(function (p) {
      if (st.filter === 'All') return true;
      if (st.filter === 'Inactive') return /Inactive/.test(p[5]);
      if (st.filter === 'Invited') return /Invited/.test(p[5]);
      return p[1] === st.filter;
    }).filter(function (p) { var q = st.q.trim().toLowerCase(); return !q || p[0].toLowerCase().indexOf(q) >= 0 || p[1].toLowerCase().indexOf(q) >= 0; });
    var filters = ['All', 'Invited', 'Field Ops', 'Estimating', 'Office', 'Safety', 'Inactive'].map(function (f) {
      var on = st.filter === f;
      return { label: f === 'Inactive' ? 'Inactive 60+ days' : f, on: on ? 'true' : 'false', pick: function () { self.setState({ filter: f, sel: {}, all: false }); },
        style: 'min-height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer; font: 600 13px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;') };
    });
    var selected = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
    var rows = shown.map(function (p) {
      var on = st.all || !!st.sel[p[0]];
      var ws = st.moved && p[1] === 'Field Ops' && p[2] === 'Field Ops' && (st.all || st.sel[p[0]]) ? 'Field Ops North' : p[2];
      var status = p[5];
      var tone = /Invited/.test(status) ? 'background: #EEF2FF; color: #3730A3;' : /Inactive|Disabled|Deactivated/.test(status) ? 'background: #FFEDD5; color: #9A3412;' : /Guest/.test(status) ? 'background: #F1F5F9; color: #334155;' : 'background: #CCFBF1; color: #115E59;';
      return { name: p[0], email: p[0].toLowerCase().replace(' ', '.') + '@northfield.example', dept: p[1], ws: ws, role: p[3], last: p[4], status: status, checked: on, aria: 'Select ' + p[0],
        open: function () { self.setState({ person: p[0], confirming: false, notice: '' }); }, first: p[0].split(' ')[0],
        toggle: function () { var s = Object.assign({}, st.sel); s[p[0]] = !s[p[0]]; self.setState({ sel: s, all: false }); },
        statusStyle: 'font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; ' + tone,
        rowStyle: 'border-top: 1px solid #EEF2F6; ' + (on ? 'background: #F5F7FF;' : '') };
    });
    var selCount = st.all ? 23 : selected.length;
    var footerText = st.filter === 'Field Ops' && !st.q ? 'Showing ' + rows.length + ' of 23 people in Field Ops' : 'Showing ' + rows.length + ' people';
    var moveCount = selCount;

    // ---- offboarding
    var stepNames = ['Last day', 'Sign out', 'Hand over work', 'Links and data', 'Confirm'];
    var steps = stepNames.map(function (n, i) {
      var state = i < st.step ? 'done' : i === st.step ? 'now' : 'later';
      return { n: (i + 1) + (state === 'done' ? ' ✓' : ''), label: n,
        style: 'display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; ' + (state === 'now' ? 'background: #0F172A; color: #FFFFFF;' : state === 'done' ? 'background: #CCFBF1; color: #134E4A;' : 'background: #FFFFFF; color: #475569; border: 1px solid #E2E8F0;') };
    });
    var dot = function (c) { return 'width: 10px; height: 10px; margin-top: 5px; border-radius: 5px; flex: none; background: ' + c + ';'; };
    var stepContent = [
      ['When should access end?', [
        { title: 'Now', body: 'Recommended: the account is already disabled in Microsoft Entra.', right: 'Selected', dot: dot('#4F46E5') },
        { title: 'At the end of a chosen day', body: 'For a planned last day. Access ends at 6:00 pm local time.', right: '', dot: dot('#CBD5E1') }
      ]],
      ['Sign out everywhere', [
        { title: 'End 3 open sessions', body: 'Phone (yesterday), office desktop (today), laptop (today). They can\'t sign back in.', right: '3 sessions', dot: dot('#4F46E5') }
      ]],
      ['Hand over open work', [
        { title: '14 open tasks', body: 'Go to Hana Kim, their manager in Entra. Each task shows "Handed over from Marcus Reyes".', right: 'To Hana Kim', dot: dot('#4F46E5') },
        { title: '3 plans owned', body: 'Kitchen Remodel, Lobby Refit and Yard Office go to Hana Kim. Choose a different person per plan if you need to.', right: 'To Hana Kim', dot: dot('#4F46E5') },
        { title: 'Finished work keeps its history', body: '"Done by Marcus Reyes" stays on completed tasks.', right: '', dot: dot('#94A3B8') }
      ]],
      ['Share links and data', [
        { title: 'Turn off 2 share links', body: 'Links Marcus created for a client stop working. Hana Kim can create new ones.', right: '2 links', dot: dot('#4F46E5') },
        { title: 'Export a copy (optional)', body: 'A zip of Marcus\'s plans and activity for your records, kept 30 days.', right: 'Skip', dot: dot('#CBD5E1') }
      ]],
      ['Ready to offboard', [
        { title: 'Access ends now and 3 sessions end', body: 'The person can\'t sign in again unless re-enabled in Entra.', right: '', dot: dot('#0F766E') },
        { title: '14 tasks and 3 plans go to Hana Kim', body: 'Hana Kim gets one summary email, not 17.', right: '', dot: dot('#0F766E') },
        { title: '1 seat is freed', body: 'Seats in use: 184 → 183.', right: '', dot: dot('#0F766E') },
        { title: 'Everything is in the audit log', body: 'Who did it, when, and each change.', right: '', dot: dot('#0F766E') }
      ]]
    ];
    var finished = st.step >= 5;
    var sc = finished ? ['Marcus Reyes is offboarded', [{ title: 'Done', body: '14 tasks and 3 plans are with Hana Kim, sessions ended, 2 share links off, 1 seat freed. Orphaned plans: none.', right: '', dot: dot('#0F766E') }]] : stepContent[st.step];

    var groups = [
      ['Construction-PMs', 23, 'Field Ops', 'Manager'],
      ['Estimators', 31, 'Estimating', 'Editor'],
      ['Safety-Team', 12, 'Safety', 'Editor'],
      ['All-Staff', 184, 'Company updates', 'Viewer']
    ].map(function (g) { return { group: g[0], count: g[1], ws: g[2], role: g[3] }; });

    return {
      isOverview: st.tab === 'overview', isPeople: st.tab === 'people', isOff: st.tab === 'off', isGroups: st.tab === 'groups',
      kpis: kpis, checklist: checklist, score: done + ' of ' + items.length + ' done', alerts: alerts, adoption: adoption,
      filters: filters, rows: rows,
      footer: footerText, q: st.q, setQ: function (e) { self.setState({ q: e.target.value }); }, clearSel: function () { self.setState({ sel: {}, all: false }); },
      selCount: selCount > 0, selText: selCount + ' selected', offerAll: !st.all && st.filter === 'Field Ops' && selected.length > 0 && selected.length < 23,
      selectAll: function () { self.setState({ all: true }); },
      openMove: function () { self.setState({ moveOpen: true }); },
      closeMove: function () { self.setState({ moveOpen: false }); },
      moveOpen: st.moveOpen, moveCount: moveCount, moveWill: Math.max(0, moveCount - 2),
      doMove: function () { self.setState({ moveOpen: false, moved: true, undo: true }); },
      undo: st.undo, undoText: 'Moved ' + Math.max(0, moveCount - 2) + ' people to Field Ops North. You can undo this for 24 hours.',
      doUndo: function () { self.setState({ moved: false, undo: false }); },
      steps: steps, offTitle: sc[0], offLines: sc[1],
      canBack: st.step > 0 && !finished, back: function () { self.setState({ step: st.step - 1 }); },
      next: function () { self.setState({ step: finished ? 0 : st.step + 1 }); },
      nextLabel: finished ? 'Start over (demo)' : st.step === 4 ? 'Offboard Marcus Reyes' : 'Continue',
      groups: groups, syncLabel: st.synced ? 'Synced just now' : 'Sync now', syncNow: function () { self.setState({ synced: true }); }
    };
  }
  extraVals() {
    var self = this;
    var st = this.state;
    // ---- person panel (same on desktop drawer and phone sheet)
    var info = {
      'Luis Park': { email: 'luis.park@northfield.example', role: 'Guest', ws: 'Kitchen Remodel (guest)', sessions: 1, owns: 0, tasks: 2, manager: 'Invited by Ana Lima', alert: '5 failed sign-ins yesterday 17:55 from 203.0.113.7. If this wasn\'t Luis, sign out everywhere; Microsoft blocks the account after 10 tries.', guest: true },
      'Marcus Reyes': { email: 'marcus.reyes@northfield.example', role: 'Editor', ws: 'Estimating', sessions: 3, owns: 3, tasks: 14, manager: 'Manager: Hana Kim', alert: 'Disabled in Microsoft Entra today. Offboarding hands over his work.', offboard: true },
      'Ivy Chen': { email: 'ivy.chen@northfield.example', role: 'Editor', ws: 'Office', sessions: 0, owns: 0, tasks: 1, manager: 'Invited by Hana Kim', invited: true },
      'Noah Diaz': { email: 'noah.diaz@northfield.example', role: 'Editor', ws: 'Field Ops', sessions: 0, owns: 0, tasks: 3, manager: 'Invited by Ana Lima', invited: true }
    };
    st.added.forEach(function (a) { info[a.name] = { email: a.email, role: a.role, ws: a.ws, sessions: 0, owns: 0, tasks: 0, manager: 'Added by you just now', invited: true, guest: a.role === 'Guest' }; });
    var name = st.person;
    var pi = name ? (info[name] || { email: name.toLowerCase().replace(' ', '.') + '@northfield.example', role: 'Editor', ws: 'Field Ops', sessions: 2, owns: 1, tasks: 6, manager: 'Manager: Ana Lima' }) : null;
    var off = name && st.deactivated[name];
    var person = pi ? {
      name: name, email: pi.email, initials: name.split(' ').map(function (w) { return w[0]; }).join(''),
      facts: [['Role', pi.role], ['Workspace', pi.ws], ['Signed in on', pi.invited ? 'Not yet' : (st.signedOut[name] ? '0 devices' : pi.sessions + (pi.sessions === 1 ? ' device' : ' devices'))], ['Plans owned', String(pi.owns)], ['Open tasks', String(pi.tasks)], ['', pi.manager]].map(function (f) { return { k: f[0], v: f[1] }; }),
      alert: pi.alert || false,
      confirming: st.confirming, choosing: !st.confirming && !off,
      off: off ? name + ' is deactivated and signed out everywhere. Undo is available until midnight.' : false,
      canResend: !!pi.invited, canSignOut: !pi.invited && !st.signedOut[name] && !off, offboard: !!pi.offboard,
      deactivateText: name + ' is signed out of ' + (pi.sessions || 0) + (pi.sessions === 1 ? ' device' : ' devices') + ' at once and can\'t sign in. ' + (pi.owns || pi.tasks ? 'Their ' + pi.tasks + ' open tasks and ' + pi.owns + ' plans stay put until you hand them over in Offboarding.' : 'Nothing else changes.') + ' You can undo this today.'
    } : false;
    var setPerson = function (o) { self.setState(o); };

    // ---- add people (one person, or several pasted / CSV) with a dry run first
    var free = 16 - st.added.filter(function (a) { return a.role !== 'Guest'; }).length;
    var email = st.addEmail.trim().toLowerCase();
    var validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    var outsider = validEmail && !/@northfield\.example$/.test(email);
    var nameFromEmail = function (e) { return e.split('@')[0].split(/[._]/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); };
    var many = [
      ['nia.brooks@northfield.example', 'add'], ['owen.patel@northfield.example', 'add'], ['tess.nguyen@northfield.example', 'dup'],
      ['sam.ortiz@harborelectric.example', 'guest'], ['kevin@northfield', 'bad']
    ];
    var manyLines = many.map(function (m) {
      var txt = { add: 'Will be added to ' + st.addWs + ' as ' + st.addRole + ', uses 1 seat', dup: 'Skipped: Tess Nguyen is already a member', guest: 'Outside your domain: becomes a Guest on the plans you pick, no seat', bad: 'Skipped: not a complete email address (line 5)' }[m[1]];
      return { email: m[0], text: txt, style: 'display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; ' + ({ add: 'background: #F0FDFA; color: #134E4A;', dup: 'background: #F1F5F9; color: #334155;', guest: 'background: #EEF2FF; color: #1E1B4B;', bad: 'background: #FFF7ED; color: #7C2D12;' }[m[1]]) };
    });
    var roleOpts = ['Viewer', 'Editor', 'Manager'].map(function (r) { var on = st.addRole === r; return { label: r, checked: on ? 'true' : 'false', pick: function () { self.setState({ addRole: r }); }, style: 'min-height: 40px; padding: 0 12px; border-radius: 9px; cursor: pointer; font: 600 14px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;') }; });
    var wsOpts = ['Field Ops', 'Estimating', 'Office', 'Safety'].map(function (w) { var on = st.addWs === w; return { label: w, checked: on ? 'true' : 'false', pick: function () { self.setState({ addWs: w }); }, style: 'min-height: 40px; padding: 0 12px; border-radius: 9px; cursor: pointer; font: 600 14px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;') }; });
    var modeOpts = [['one', 'One person'], ['many', 'Several at once']].map(function (m) { var on = st.addMode === m[0]; return { label: m[1], checked: on ? 'true' : 'false', pick: function () { self.setState({ addMode: m[0], addStep: 'form' }); }, style: 'flex: 1; min-height: 40px; padding: 0 12px; border-radius: 8px; border: none; cursor: pointer; font: 600 14px Inter, sans-serif; ' + (on ? 'background: #FFFFFF; color: #0F172A; box-shadow: 0 1px 2px rgba(15,23,42,0.12);' : 'background: transparent; color: #475569;') }; });
    var addCount = st.addMode === 'one' ? 1 : 2;
    var addError = st.addMode === 'one' && st.addStep === 'form' && email && !validEmail ? 'Enter a full email address, like name@northfield.example' : false;
    var onePreview = outsider
      ? [{ email: email, text: 'Outside northfield.example, so ' + nameFromEmail(email) + ' joins as a Guest: only the plans you pick, no seat, expires after 90 days (your policy).', style: 'display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: #EEF2FF; color: #1E1B4B;' }]
      : [{ email: email, text: nameFromEmail(email) + ' will be added to ' + st.addWs + ' as ' + st.addRole + ' and uses 1 seat (' + free + ' free → ' + (free - 1) + ').', style: 'display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: #F0FDFA; color: #134E4A;' }];
    var doAdd = function () {
      var list = st.addMode === 'one'
        ? [{ email: email, name: nameFromEmail(email), dept: outsider ? 'Guest' : st.addWs, ws: outsider ? 'Plans you pick (guest)' : st.addWs, role: outsider ? 'Guest' : st.addRole, status: 'Invited · just now' }]
        : [{ email: many[0][0], name: 'Nia Brooks', dept: st.addWs, ws: st.addWs, role: st.addRole, status: 'Invited · just now' }, { email: many[1][0], name: 'Owen Patel', dept: st.addWs, ws: st.addWs, role: st.addRole, status: 'Invited · just now' }, { email: many[3][0], name: 'Sam Ortiz', dept: 'Guest', ws: 'Plans you pick (guest)', role: 'Guest', status: 'Invited · just now' }];
      self.setState({ added: st.added.concat(list), addOpen: false, addStep: 'form', tab: 'people', filter: 'Invited', q: '', notice: (list.length === 1 ? list[0].name + ' was' : list.length + ' people were') + ' invited. They get a welcome email with a "Sign in with Microsoft" button; you\'ll see "Invited" until they sign in. Logged in the audit log.' });
    };
    return {
      person: person, isOpenPerson: !!person,
      closePerson: function () { setPerson({ person: null, confirming: false }); },
      askDeactivate: function () { setPerson({ confirming: true }); },
      cancelConfirm: function () { setPerson({ confirming: false }); },
      deactivate: function () { var d = Object.assign({}, st.deactivated); d[name] = true; setPerson({ deactivated: d, confirming: false, notice: name + ' is deactivated and signed out everywhere. Undo is available until midnight. Hand over their work in Offboarding.' }); },
      undoDeactivate: function () { var d = Object.assign({}, st.deactivated); delete d[name]; setPerson({ deactivated: d, notice: '' }); },
      signOutAll: function () { var so = Object.assign({}, st.signedOut); so[name] = true; setPerson({ signedOut: so, notice: name + ' was signed out on every device. Logged in the audit log.' }); },
      resend: function () { setPerson({ notice: 'Invite sent again to ' + name + '.' }); },
      goOffboard: function () { setPerson({ tab: 'off', step: 0, person: null, menu: false }); },
      notice: st.notice || false, clearNotice: function () { self.setState({ notice: '' }); },
      addOpen: st.addOpen, openAdd: function () { self.setState({ addOpen: true, addStep: 'form', notice: '' }); }, closeAdd: function () { self.setState({ addOpen: false }); },
      openAddMany: function () { self.setState({ addOpen: true, addMode: 'many', addStep: 'form', notice: '' }); },
      modeOpts: modeOpts, isOne: st.addMode === 'one', isMany: st.addMode === 'many', addForm: st.addStep === 'form', addPreview: st.addStep === 'preview',
      addEmail: st.addEmail, setAddEmail: function (e) { self.setState({ addEmail: e.target.value }); },
      addError: addError, roleOpts: roleOpts, wsOpts: wsOpts, roleHidden: outsider && st.addMode === 'one',
      seatNote: free + ' of 200 seats free. People on northfield.example use a seat; anyone else joins as a Guest without one.',
      syncNote: 'Most people arrive by themselves from Microsoft Entra ID. Add someone here only if they aren\'t in Entra yet, like a contractor or a new hire starting today.',
      manyText: many.map(function (m) { return m[0]; }).join('\n'),
      previewRows: st.addMode === 'one' ? onePreview : manyLines,
      previewTitle: st.addMode === 'one' ? 'Check before you send' : '5 rows checked: 2 will be added, 1 Guest, 2 skipped',
      toPreview: function () { if (!(st.addMode === 'one' && !validEmail)) self.setState({ addStep: 'preview' }); },
      backToForm: function () { self.setState({ addStep: 'form' }); },
      doAdd: doAdd, addLabel: st.addMode === 'one' ? 'Send invite' : 'Invite 3 people',
      previewDisabled: st.addMode === 'one' && !validEmail,
      previewStyle: 'min-height: 46px; padding: 0 18px; border-radius: 10px; border: none; font: 600 15px Inter, sans-serif; color: #FFFFFF; ' + (st.addMode === 'one' && !validEmail ? 'background: #94A3B8; cursor: not-allowed;' : 'background: #4F46E5; cursor: pointer;')
    };
  }
  spendVals() {
    var self = this;
    var st = this.state;
    var f = { month: 1, last: 1.18, q: 3.1 }[st.spPeriod || 'month'];
    var money = function (v) { return '$' + (v * f).toFixed(2); };
    // Fictional Northfield usage: Opus 5.5 checks (~5.5 cents each), Haiku 5.5 reports (~0.1 cent).
    var people = [
      ['Hana Kim', 'Estimating', 5.12, 88, 14, 612, 140, 4.10, ['Kitchen Remodel', 'Lobby Refit']],
      ['Ana Lima', 'Field Ops', 3.95, 68, 11, 470, 108, 4.40, ['Kitchen Remodel', 'Yard Office']],
      ['Tess Nguyen', 'Field Ops', 2.6, 45, 6, 310, 71, 1.20, ['Yard Office', 'Warehouse Roof']],
      ['Jun Watanabe', 'Field Ops', 1.7, 29, 9, 203, 47, 1.90, ['Warehouse Roof']],
      ['Sofia Costa', 'Safety', 0.94, 16, 4, 112, 26, 0.80, ['Safety Audit Q4']],
      ['Dana Okafor', 'Field Ops', 0.33, 6, 0, 40, 9, 0, ['Fit-out Level 3']],
      ['Ravi Shah', 'Office', 0, 0, 0, 0, 0, 0.30, []],
      ['Mira Haddad', 'Field Ops', 0, 0, 0, 0, 0, 0, []]
    ];
    var projects = [
      ['Kitchen Remodel', 'Field Ops', 4.8, 83, ['Hana Kim', 'Ana Lima']],
      ['Lobby Refit', 'Estimating', 3.9, 70, ['Hana Kim']],
      ['Yard Office', 'Field Ops', 2.75, 48, ['Ana Lima', 'Tess Nguyen']],
      ['Warehouse Roof', 'Field Ops', 1.6, 31, ['Tess Nguyen', 'Jun Watanabe']],
      ['Safety Audit Q4', 'Safety', 0.94, 20, ['Sofia Costa']],
      ['Fit-out Level 3', 'Field Ops', 0.33, 6, ['Dana Okafor']],
      ['Parking Lot Resurface', 'Office', 0, 0, []]
    ];
    var depts = [['Field Ops', 8.58, 96, 22], ['Estimating', 5.12, 31, 6], ['Safety', 0.94, 16, 3], ['Office', 0, 41, 0]];
    var total = people.reduce(function (n, p) { return n + p[2]; }, 0) + 1.1; // + import screening
    var lastTotal = 13.80;
    var key = st.spTab || 'people';
    var sortBy = st.spSort || 'cost';
    var dir = function (a, b) { return sortBy === 'name' ? (a.name < b.name ? -1 : 1) : b.costN - a.costN; };
    var go = function (type, name) { return function () { self.setState({ spDetail: { type: type, name: name } }); }; };
    var share = function (c) { return total ? Math.round(c / total * 100) : 0; };
    var bar = function (c) { var mx = 5.12; return 'width: ' + Math.max(c ? 3 : 0, Math.round(c / mx * 100)) + '%; background: #2a78d6; border-radius: 0 4px 4px 0;'; };
    var rowsPeople = people.map(function (p) { return { name: p[0], sub: p[1], costN: p[2], cost: money(p[2]), a: p[3] + ' checks', b: p[4] + ' reports', c: Math.round((p[3] / 100) * 100) + '% of allowance', change: p[2] === p[7] ? 'same' : (p[2] > p[7] ? '+' : '−') + money(Math.abs(p[2] - p[7])).slice(0), share: share(p[2]) + '%', bar: bar(p[2]), open: go('person', p[0]) }; });
    var rowsProjects = projects.map(function (p) { return { name: p[0], sub: p[1], costN: p[2], cost: money(p[2]), a: p[3] + ' runs', b: p[3] ? '$' + (p[2] / p[3]).toFixed(3) + ' per run' : 'no runs', c: p[4].length + ' using AI', change: '', share: share(p[2]) + '%', bar: bar(p[2]), open: go('project', p[0]) }; });
    var rowsDepts = depts.map(function (d) { return { name: d[0], sub: d[2] + ' people', costN: d[1], cost: money(d[1]), a: d[3] + ' using AI', b: d[3] ? '$' + (d[1] / d[3]).toFixed(2) + ' per active person' : 'nobody yet', c: Math.round(d[3] / d[2] * 100) + '% of people', change: '', share: share(d[1]) + '%', bar: bar(d[1]), open: go('department', d[0]) }; });
    var rows = (key === 'people' ? rowsPeople : key === 'projects' ? rowsProjects : rowsDepts).slice().sort(dir);
    var tabs = [['people', 'People'], ['projects', 'Projects'], ['departments', 'Departments']].map(function (x) { var on = key === x[0]; return { label: x[1], on: on ? 'true' : 'false', pick: function () { self.setState({ spTab: x[0], spDetail: null }); }, style: 'flex: 1; min-height: 40px; padding: 0 12px; border-radius: 8px; border: none; cursor: pointer; font: 600 14px Inter, sans-serif; ' + (on ? 'background: #FFFFFF; color: #0F172A; box-shadow: 0 1px 2px rgba(15,23,42,0.12);' : 'background: transparent; color: #475569;') }; });
    var periods = [['month', 'This month'], ['last', 'Last month'], ['q', 'Last 90 days']].map(function (x) { var on = (st.spPeriod || 'month') === x[0]; return { label: x[1], on: on ? 'true' : 'false', pick: function () { self.setState({ spPeriod: x[0] }); }, style: 'min-height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer; font: 600 13px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;') }; });
    // Cost per day: this month (solid blue) vs last month (dashed orange), one axis.
    var cur = [0.42,0.61,0.55,0.38,0.12,0.08,0.71,0.83,0.66,0.59,0.74,0.15,0.1,0.92,1.08,0.77,0.69,0.81,0.2,0.11,0.95,1.12,0.94];
    var prev = [0.35,0.5,0.47,0.52,0.1,0.07,0.6,0.58,0.64,0.49,0.55,0.12,0.09,0.66,0.71,0.62,0.6,0.58,0.14,0.08,0.73,0.69,0.75,0.61,0.57,0.11,0.07,0.52,0.48,0.39];
    // Scale the day series so the chart's totals match the cost cards exactly.
    var ks = function (arr, to) { var s = arr.reduce(function (a, b) { return a + b; }, 0); return arr.map(function (v) { return v * to / s; }); };
    cur = ks(cur, total); prev = ks(prev, lastTotal);
    var W = 600, H = 150, mx = 1.4;
    var pts = function (arr) { return arr.map(function (v, i) { return Math.round(40 + i * (W - 60) / 29) + ',' + Math.round(10 + (H - 30) * (1 - v / mx)); }).join(' '); };
    var lastPt = function (arr) { var i = arr.length - 1; return { x: Math.round(40 + i * (W - 60) / 29), y: Math.round(10 + (H - 30) * (1 - arr[i] / mx)) }; };
    var top = function (rs) { return rs.slice().sort(function (a, b) { return b.costN - a.costN; }).slice(0, 5).map(function (r) { return { name: r.name, cost: r.cost, share: r.share, open: r.open, bar: r.bar }; }); };
    // Detail
    var det = st.spDetail;
    var detail = false;
    if (det) {
      var p = people.filter(function (x) { return x[0] === det.name; })[0];
      var pr = projects.filter(function (x) { return x[0] === det.name; })[0];
      var dp = depts.filter(function (x) { return x[0] === det.name; })[0];
      var cost = p ? p[2] : pr ? pr[2] : dp ? dp[1] : 0;
      var related = p ? p[8].map(function (n) { return { label: n, kind: 'Project', open: go('project', n) }; }).concat([{ label: p[1], kind: 'Department', open: go('department', p[1]) }])
        : pr ? pr[4].map(function (n) { return { label: n, kind: 'Person', open: go('person', n) }; }).concat([{ label: pr[1], kind: 'Department', open: go('department', pr[1]) }])
        : people.filter(function (x) { return x[1] === det.name; }).map(function (x) { return { label: x[0], kind: 'Person', open: go('person', x[0]) }; }).concat(projects.filter(function (x) { return x[1] === det.name; }).map(function (x) { return { label: x[0], kind: 'Project', open: go('project', x[0]) }; }));
      var checksShare = cost ? 0.93 : 0;
      detail = {
        title: det.name, kind: { person: 'Person', project: 'Project', department: 'Department' }[det.type],
        cost: money(cost),
        facts: [
          ['Plan Check (Opus 5.5)', money(cost * checksShare)],
          ['Status reports (Haiku 5.5)', money(cost * (1 - checksShare))],
          ['Input tokens', p ? p[5] + 'K' : Math.round(cost * 120) + 'K'],
          ['Output tokens', p ? p[6] + 'K' : Math.round(cost * 27) + 'K'],
          ['Average cost per run', cost ? '$' + (cost / Math.max(1, p ? p[3] + p[4] : pr ? pr[3] : dp[3] * 10)).toFixed(3) : 'no runs'],
          ['Declined by the AI', det.name === 'Yard Office' || det.name === 'Ana Lima' ? '1 (held for review, released)' : 'none']
        ].map(function (x) { return { k: x[0], v: x[1] }; }),
        related: related,
        note: cost === 0 ? 'No AI use this period. If this team plans a lot, it may be worth showing them the AI check.' : ''
      };
    }
    return {
      isSpending: st.tab === 'spending',
      spPeriods: periods, spTabs: tabs, spRows: rows,
      spSortCost: function () { self.setState({ spSort: 'cost' }); }, spSortName: function () { self.setState({ spSort: 'name' }); },
      spTotal: money(total), spChange: Math.round((total / lastTotal - 1) * 100) + '% vs last month',
      spPool: '612 of 1,000 checks used · 64 of 300 reports',
      spPoolBar: 'width: 61%; background: #2a78d6; border-radius: 4px;',
      spTokens: '1.9M input · 0.4M output tokens',
      spRuns: '257 checks · 44 reports · 31 imports screened',
      spCur: pts(cur), spPrev: pts(prev),
      spCurEnd: lastPt(cur), spPrevEnd: lastPt(prev),
      spCurLabel: 'This month so far ' + money(total),
      spPrevLabel: 'Last month $' + lastTotal.toFixed(2),
      spTopPeople: top(rowsPeople), spTopProjects: top(rowsProjects), spTopDepts: top(rowsDepts),
      spIdle: 'Ravi Shah, Mira Haddad · Parking Lot Resurface · Office (41 people)',
      spDetail: detail, spBack: function () { self.setState({ spDetail: null }); },
      spCsv: function () { self.setState({ spCsvDone: true }); }, spCsvLabel: st.spCsvDone ? 'Downloaded' : 'Export CSV'
    };
  }

  securityVals() {
    var self = this;
    var st = this.state;
    var pill = function (on) { return 'min-height: 38px; padding: 0 12px; border-radius: 9px; cursor: pointer; font: 600 13px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;'); };

    // ---- setup
    var steps = [
      ['Verify northfield.example', 'DNS record found Nov 18.', 'Done', true],
      ['Connect Microsoft sign-in', 'Admin consent given; everyone signs in with work accounts.', 'Done', true],
      ['Turn on directory sync', 'Microsoft Entra ID pushes hires, leavers and changes.', 'Done', true],
      ['Map groups to workspaces', '4 groups mapped.', 'Done', true],
      ['Choose policies', 'Standard preset, with share links needing approval.', 'Done', true],
      ['Bring your people', st.peopleDone ? '184 people added by sync; welcome email sent.' : '184 people are ready from sync. Preview the welcome email, then send.', st.peopleDone ? 'Done' : 'About 5 min', st.peopleDone]
    ];
    var done = steps.filter(function (s) { return s[3]; }).length;
    var setup = steps.map(function (s, i) {
      return { title: s[0], body: s[1], time: s[3] ? '' : s[2], icon: s[3] ? '✓' : String(i + 1), action: s[3] ? false : 'Preview and send', act: function () { self.setState({ peopleDone: true }); },
        iconStyle: 'width: 28px; height: 28px; border-radius: 14px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; ' + (s[3] ? 'background: #CCFBF1; color: #115E59;' : 'background: #EEF2FF; color: #3730A3;') };
    });

    // ---- policies (draft value → impact text; save applies)
    var cur = function (k) { return st.draft[k] !== undefined ? st.draft[k] : st.pol[k]; };
    var defs = [
      { key: 'links', title: 'Public share links', body: 'Read-only links people can send to clients.', opts: [['on', 'Allowed'], ['approval', 'Need approval'], ['off', 'Off']],
        impact: function (v) { return v === 'off' ? '12 existing links stop working right away. Their 9 owners get an email. Plans aren\'t affected.' : v === 'on' ? 'People can create links without approval. 3 waiting requests are approved automatically.' : null; } },
      { key: 'guests', title: 'Guests expire after', body: 'Outside collaborators lose access after this long without a renewal.', opts: [[30, '30 days'], [90, '90 days'], [0, 'Never']],
        impact: function (v) { return v === 30 ? '4 of 11 guests have been in for more than 30 days and lose access tonight. Their inviters get a renew link.' : v === 0 ? 'Guests keep access until someone removes them. This lowers your security checklist score.' : null; } },
      { key: 'week', title: 'Standard work week for new workspaces', body: 'What "Full time" means when a team creates a workspace. Each workspace can change its own.', opts: [['40', '40 h'], ['37.5', '37.5 h'], ['35', '35 h']],
        impact: function (v) { return v === '40' ? null : 'New workspaces start at ' + v + ' h a week. Your 6 existing workspaces keep their own setting; managers can switch each one in its settings, with its own preview.'; } },
      { key: 'ai', title: 'AI features', body: 'Plan Check and status reports use EZPLAN\'s built-in AI unless you add your own key.', opts: [['on', 'On'], ['managers', 'Managers only'], ['off', 'Off']],
        impact: function (v) { return v === 'off' ? 'Plan Check keeps its free checks; AI reviews and AI status reports stop. 41 plans lose their AI review badge.' : v === 'managers' ? '143 people lose AI features; 41 managers keep them.' : null; } }
    ];
    var policies = defs.map(function (d) {
      var v = cur(d.key);
      var changed = st.draft[d.key] !== undefined && st.draft[d.key] !== st.pol[d.key];
      return {
        title: d.title, body: d.body,
        options: d.opts.map(function (o) {
          var on = v === o[0];
          return { label: o[1], checked: on ? 'true' : 'false', style: pill(on), pick: function () { var dr = Object.assign({}, st.draft); dr[d.key] = o[0]; var sv = Object.assign({}, st.saved); delete sv[d.key]; self.setState({ draft: dr, saved: sv }); } };
        }),
        impact: changed ? (d.impact(v) || 'No one is affected right away.') : false,
        cancel: function () { var dr = Object.assign({}, st.draft); delete dr[d.key]; self.setState({ draft: dr }); },
        save: function () { var p = Object.assign({}, st.pol); p[d.key] = v; var dr = Object.assign({}, st.draft); delete dr[d.key]; var sv = Object.assign({}, st.saved); sv[d.key] = 'Saved. Logged in the audit log by you, just now.'; self.setState({ pol: p, draft: dr, saved: sv }); },
        saved: st.saved[d.key] || false
      };
    });

    // ---- audit
    var allEvents = [
      ['Today 10:42', 'Hana Kim', 'Offboarded Marcus Reyes: 14 tasks and 3 plans handed over, 3 sessions ended', 'Admin console', 'People'],
      ['Today 10:41', 'Microsoft Entra ID', 'Marcus Reyes disabled (sync)', 'Directory sync', 'People'],
      ['Today 09:12', 'Ana Lima', 'Moved 21 people to Field Ops North', 'Admin console', 'People'],
      ['Today 08:03', 'Tess Nguyen', 'Signed in', 'Microsoft · Chrome on Windows', 'Sign-ins'],
      ['Yesterday 17:55', 'unknown', '5 failed sign-ins for luis.park@northfield.example', 'Microsoft · 203.0.113.7', 'Sign-ins'],
      ['Yesterday 16:20', 'Hana Kim', 'Share links: Allowed → Need approval', 'Policies', 'Settings'],
      ['Nov 21 14:02', 'Hana Kim', 'Exported 3 plans as files', 'Kitchen Remodel', 'Data']
    ];
    var events = allEvents.filter(function (e) { return st.audit === 'All' || e[4] === st.audit; }).map(function (e) { return { when: e[0], who: e[1], what: e[2], from: e[3] }; });
    var auditFilters = ['All', 'People', 'Sign-ins', 'Settings', 'Data'].map(function (f) {
      var on = st.audit === f;
      return { label: f, on: on ? 'true' : 'false', style: 'min-height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer; font: 600 13px Inter, sans-serif; ' + (on ? 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;' : 'background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1;'), pick: function () { self.setState({ audit: f }); } };
    });
    var siemNotes = { Splunk: 'Splunk HTTP Event Collector: paste your collector address and token. We test the connection before saving.', 'Microsoft Sentinel': 'Microsoft Sentinel: connect through your Log Analytics workspace (workspace ID and key).', Datadog: 'Datadog Logs: paste your site and API key; events arrive tagged by type.', Webhook: 'Any HTTPS address: we POST each event as JSON with a signature header.' };
    var siem = ['Splunk', 'Microsoft Sentinel', 'Datadog', 'Webhook'].map(function (s) { var on = st.siem === s; return { label: s, checked: on ? 'true' : 'false', style: pill(on), pick: function () { self.setState({ siem: s }); } }; });

    // ---- licenses
    var seats = [
      { label: 'Seats bought', value: '200', note: 'Renews Mar 1, 2027' },
      { label: 'In use', value: '184', note: '16 free' },
      { label: 'Inactive 60+ days', value: '9', note: st.reclaim ? '9 emailed today; seats free on Dec 7' : 'Reclaim is off' },
      { label: 'This year', value: '$28,800', note: '200 seats × $12 × 12 months' }
    ];
    var depts = [['Field Ops', 96], ['Estimating', 31], ['Office', 41], ['Safety', 16]].map(function (d) {
      return { dept: d[0], text: d[1] + ' seats · $' + (d[1] * 12 * 12).toLocaleString('en-US'), bar: 'width: ' + (d[1] / 184 * 100) + '%; background: #4F46E5;' };
    });

    return {
      isSetup: st.tab === 'setup', isPolicies: st.tab === 'policies', isAudit: st.tab === 'audit', isLicenses: st.tab === 'licenses',
      setup: setup, setupSummary: done + ' of 6 steps done' + (done === 6 ? '. Northfield Builders is set up.' : '. About 5 minutes left.'),
      setupBar: 'width: ' + (done / 6 * 100) + '%; background: #0F766E;',
      handoffLabel: st.handoff ? 'Link copied' : 'Copy setup link', copyHandoff: function () { self.setState({ handoff: true }); },
      policies: policies,
      auditFilters: auditFilters, events: events, siem: siem, siemNote: siemNotes[st.siem],
      seats: seats, depts: depts,
      reclaimOn: st.reclaim ? 'true' : 'false', reclaimLabel: st.reclaim ? 'On' : 'Turn on',
      reclaimStyle: 'min-height: 40px; padding: 0 16px; border-radius: 10px; cursor: pointer; font: 600 14px Inter, sans-serif; ' + (st.reclaim ? 'background: #CCFBF1; color: #115E59; border: 1px solid #5EEAD4;' : 'background: #0F172A; color: #FFFFFF; border: 1px solid #0F172A;'),
      reclaimNote: st.reclaim ? 'On. 9 people were emailed today; if they don\'t sign in by Dec 7, 9 seats are freed (saves $1,296 a year).' : 'Right now 9 people haven\'t signed in for 60+ days: about $1,296 a year in unused seats.',
      toggleReclaim: function () { self.setState({ reclaim: !st.reclaim }); }
    };
  }
}
