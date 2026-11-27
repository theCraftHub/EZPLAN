/**
 * Business onboarding (step L2, from the approved BusinessOnboarding board): one step per screen
 * with a progress bar. Company → verify your domain → bring your people → rules → first plan →
 * Go live. Progress is saved after every step, so setup can be left and picked up from Home.
 * Nothing goes to employees until Go live.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ClipboardCopy } from "lucide-react";
import { BRAND, TEMPLATES, templateText } from "@rakuplan/shared";
import { api, ApiError, type Me, type OnboardingStep, type OrgDetail, type OrgInviteCheck, type OrgRole, type PlanSummary, type RulePreset } from "../lib/api";
import { plural } from "../lib/format";
import { Link, useRouter } from "../lib/router";
import { Button, Card, Notice, Spinner } from "../ui/kit";
import { PeopleEditor, ROLE_WORD, usePeopleList } from "../ui/PeopleEditor";

const STEPS: { key: OnboardingStep; label: string; mins: number }[] = [
  { key: "company", label: "Company", mins: 2 },
  { key: "domain", label: "Domain", mins: 3 },
  { key: "people", label: "People", mins: 4 },
  { key: "rules", label: "Rules", mins: 1 },
  { key: "first", label: "First plan", mins: 2 },
  { key: "live", label: "Go live", mins: 1 },
];
const STEP_KEYS = STEPS.map((s) => s.key);
const INDUSTRIES = ["Construction", "Events", "Marketing", "Software", "Professional services", "Healthcare", "Education", "Manufacturing", "Nonprofit", "Other"];
const INDUSTRY_TEMPLATE: Record<string, string> = { Construction: "construction", Events: "event", Marketing: "marketing", Software: "launch", Education: "research", Healthcare: "research" };
const PERSONAL_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "example.com"]);

export const RULES: Record<RulePreset, { label: string; hint: string; means: string[] }> = {
  standard: {
    label: "Standard (recommended)",
    hint: "Managers can invite people from outside the company; those guests lose access after 90 days.",
    means: ["Managers can invite people from outside the company to a plan.", "Guests from outside lose access after 90 days. Invite them again to extend it.", "Everyone in a plan can download it as a file."],
  },
  strict: {
    label: "Strict",
    hint: "Only Owners and Admins invite guests, who lose access after 30 days. Only Owners and Admins download plan files.",
    means: ["Only Owners and Admins can invite people from outside the company.", "Guests from outside lose access after 30 days.", "Only Owners and Admins can download plan files."],
  },
  open: {
    label: "Open",
    hint: "Anyone who can share a plan can invite guests; good for small teams.",
    means: ["Anyone who can share a plan can invite people from outside the company.", "Guests from outside keep access until someone removes them.", "Everyone in a plan can download it as a file."],
  },
};

const input = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function BusinessStart({ me, orgId, step }: { me: Me; orgId?: string; step?: string }) {
  const { go } = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState("");
  const reload = () => (orgId ? api.org(orgId).then(setOrg).catch((e: Error) => setError(e.message)) : Promise.resolve());
  useEffect(() => { void reload(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  // /business/:org alone resumes at the saved step.
  useEffect(() => {
    if (org && !step) go(`/business/${org.id}/${org.onboarding.done ? "live" : org.onboarding.step ?? "domain"}`, { replace: true });
  }, [org, step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!orgId) return <CompanyStep me={me} />;
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!org || !step) return <Spinner label="Loading your company" />;
  if (!org.can.settings) return <Notice tone="warn">Only the company's Owners and Admins can set it up.</Notice>;
  const at = STEP_KEYS.includes(step as OnboardingStep) ? (step as OnboardingStep) : "domain";
  const goTo = async (next: OnboardingStep, extra: Record<string, unknown> = {}) => {
    await api.saveOnboarding(org.id, { step: next, ...extra });
    await reload();
    go(`/business/${org.id}/${next}`);
  };
  const props = { me, org, goTo, reload };
  if (at === "domain" || at === "company") return <DomainStep {...props} />;
  if (at === "people") return <PeopleStep {...props} />;
  if (at === "rules") return <RulesStep {...props} />;
  if (at === "first") return <FirstStep {...props} />;
  return <LiveStep {...props} />;
}

type StepProps = { me: Me; org: OrgDetail; goTo: (next: OnboardingStep, extra?: Record<string, unknown>) => Promise<void>; reload: () => Promise<unknown> };

/** The frame every step shares: where you are, the step's title, its content, Back and Continue. */
function Frame({ step, kicker, title, lead, children, back, next, nextLabel, nextDisabled, alt, error }: {
  step: OnboardingStep; kicker: string; title: string; lead?: ReactNode; children?: ReactNode;
  back?: () => void; next?: () => void | Promise<void>; nextLabel?: string; nextDisabled?: boolean; alt?: ReactNode; error?: string;
}) {
  const idx = STEP_KEYS.indexOf(step);
  const left = STEPS.slice(idx).reduce((n, s) => n + s.mins, 0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const run = async () => {
    if (!next) return;
    setBusy(true);
    setFailed("");
    try { await next(); } catch (e) { setFailed(message(e, "That didn't save. Check your connection and try again.")); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted">Set up your business · Step {idx + 1} of {STEPS.length}: {STEPS[idx]!.label} · {step === "live" ? "ready to go live" : `about ${left} min left`}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={idx + 1}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-xs font-bold tracking-wider text-primary-ink">{kicker}</p>
          <h1 className="m-0 text-[24px] leading-tight font-bold tracking-tight">{title}</h1>
          {lead && <p className="m-0 text-[15px] leading-relaxed text-ink-2">{lead}</p>}
        </div>
        {children}
        {(error || failed) && <Notice tone="bad">{error || failed}</Notice>}
        {(back || next || alt) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {back && <Button variant="secondary" onClick={back}><ArrowLeft aria-hidden size={18} /> Back</Button>}
            <span className="flex-1" />
            {alt}
            {next && <Button onClick={() => void run()} disabled={busy || nextDisabled}>{busy ? "Saving…" : nextLabel ?? "Continue"}</Button>}
          </div>
        )}
      </Card>
    </div>
  );
}

function Choice({ checked, onPick, label, hint, name }: { checked: boolean; onPick: () => void; label: string; hint?: string; name: string }) {
  return (
    <label className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl p-3.5 ${checked ? "bg-surface-2 ring-2 ring-ink" : "bg-surface ring-1 ring-line hover:bg-surface-2"}`}>
      <input type="radio" name={name} checked={checked} onChange={onPick} className="mt-1 h-5 w-5 shrink-0" />
      <span className="flex flex-col gap-0.5"><span className="text-[15px] font-semibold">{label}</span>{hint && <span className="text-sm text-ink-2">{hint}</span>}</span>
    </label>
  );
}

function Note({ title, children, tone = "plain" }: { title: string; children: ReactNode; tone?: "plain" | "info" | "good" }) {
  const cls = { plain: "bg-surface-2 ring-line text-ink-2", info: "bg-primary-soft ring-primary/30 text-primary-ink", good: "bg-good-soft ring-good/30 text-good" }[tone];
  return <div className={`flex flex-col gap-1 rounded-xl p-3.5 ring-1 ${cls}`}><strong className="text-[15px]">{title}</strong><span className="text-sm leading-relaxed">{children}</span></div>;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})} aria-label={`${label}: ${text}`}>
      {copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> {label}</>}
    </Button>
  );
}

// ---------------------------------------------------------------- 1. company

function CompanyStep({ me }: { me: Me }) {
  const { go } = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(me.user.email);
  const [industry, setIndustry] = useState("");
  const [people, setPeople] = useState("");
  const count = Number(people);
  return (
    <Frame
      step="company" kicker="ABOUT YOUR COMPANY" title="Start your business account"
      lead="You'll be the owner. You can add other admins later."
      back={() => go("/")}
      nextDisabled={!name.trim() || !Number.isInteger(count) || count < 1}
      next={async () => {
        const made = await api.createOrg(name.trim(), industry, count);
        await api.saveOnboarding(made.id, { step: "domain", email: email.trim() });
        go(`/business/${made.id}/domain`, { replace: true });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Company name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Northfield Builders" className={input} autoComplete="organization" /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Your work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Industry
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={input}><option value="">Choose one</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">People who will use it<input type="number" inputMode="numeric" min={1} value={people} onChange={(e) => setPeople(e.target.value)} placeholder="About how many?" className={input} /></label>
      </div>
      <p className="m-0 text-sm text-muted">The number of people becomes your seat count. You can change it any time.</p>
    </Frame>
  );
}

// ---------------------------------------------------------------- 2. domain

function DomainStep({ me, org, goTo, reload }: StepProps) {
  const from = (org.onboarding.email || me.user.email).split("@")[1]?.toLowerCase() ?? "";
  const added = org.domains[0];
  const [domain, setDomain] = useState(added?.domain ?? (PERSONAL_MAIL.has(from) ? "" : from));
  const [state, setState] = useState<{ verified: boolean; reason?: string } | null>(added?.verified ? { verified: true } : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(message(e, "That didn't work. Try again.")); } finally { setBusy(false); } };
  const name = added?.domain ?? domain;
  return (
    <Frame
      step="domain" kicker="VERIFY YOUR DOMAIN" title={added ? `Show that ${added.domain} is yours` : "Show that your domain is yours"}
      lead={<>Add this record where your domain is managed (your IT person or domain provider can do it in 2 minutes). Once it's verified, people on {name ? `@${name}` : "your domain"} can only join as members, not as outside guests. You don't have to wait here: you can check again later.</>}
      error={error}
      nextLabel={state?.verified ? "Continue" : added ? "Continue, check again later" : "Skip for now"}
      next={() => goTo("people")}
    >
      {!added ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold">Your company's domain<input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="northfield.com" className={input} /></label>
          <Button disabled={busy || !domain.trim()} onClick={() => void act(async () => { await api.addDomain(org.id, domain.trim()); await reload(); })}>Get the record</Button>
        </div>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl bg-surface-2 p-4 text-[15px] ring-1 ring-line">
            <dt className="font-semibold text-ink-2">Type</dt><dd className="m-0 font-mono">TXT</dd>
            <dt className="font-semibold text-ink-2">Name</dt><dd className="m-0 font-mono">@ ({added.domain})</dd>
            <dt className="font-semibold text-ink-2">Value</dt><dd className="m-0 min-w-0 font-mono break-all">{added.record}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={added.record} label="Copy the value" />
            {!state?.verified && <Button variant="secondary" disabled={busy} onClick={() => void act(async () => { const r = await api.checkDomain(org.id, added.domain); setState(r); if (r.verified) await reload(); })}>{busy ? "Checking…" : "Check now"}</Button>}
          </div>
          <p role="status" className={`m-0 text-[15px] font-semibold ${state?.verified ? "text-good" : "text-ink-2"}`}>
            {state?.verified ? `✓ Found. ${added.domain} is verified.` : state?.reason ?? "Waiting for the record"}
          </p>
        </>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- 3. people

function PeopleStep({ org, goTo }: StepProps) {
  const { list, view } = usePeopleList(org, org.onboarding.people ?? []);
  return (
    <Frame
      step="people" kicker="BRING YOUR PEOPLE" title="Who should join?"
      lead="Paste names and email addresses, or upload a spreadsheet. We check every row and show you the result before anyone is added."
      back={() => void goTo("domain", { people: list.requests })}
      nextLabel={list.rows.length ? "Continue" : "Skip, add people later"}
      nextDisabled={list.busy || list.dirty}
      next={() => goTo("rules", { people: list.requests })}
    >
      <PeopleEditor view={view} />
      <Note title="A second admin (recommended)">So someone can still manage people when you're away, set one person's role to Admin.</Note>
      <Note title="Nobody is emailed yet">Invites go out only when you press Go live, at the end.</Note>
    </Frame>
  );
}

// ---------------------------------------------------------------- 4. rules

function RulesStep({ org, goTo }: StepProps) {
  const [preset, setPreset] = useState<RulePreset>(org.rules.preset);
  return (
    <Frame
      step="rules" kicker="YOUR RULES" title="Pick a starting set of rules"
      back={() => void goTo("people")}
      next={async () => { await api.setRules(org.id, preset); await goTo("first"); }}
    >
      <div role="radiogroup" aria-label="Rules" className="flex flex-col gap-2">
        {(Object.keys(RULES) as RulePreset[]).map((k) => <Choice key={k} name="rules" checked={preset === k} onPick={() => setPreset(k)} label={RULES[k].label} hint={RULES[k].hint} />)}
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
        <strong className="text-[15px]">What this means</strong>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-2">
          {RULES[preset].means.map((m) => <li key={m}>{m}</li>)}
          <li>Every download of a company plan is recorded in the audit log.</li>
        </ul>
      </div>
      <p className="m-0 text-sm text-muted">You can change the rules later in the admin console.</p>
    </Frame>
  );
}

// ---------------------------------------------------------------- 5. first plan

function FirstStep({ org, goTo }: StepProps) {
  const { go } = useRouter();
  const ws = org.workspaces[0]!.id;
  const suggested = INDUSTRY_TEMPLATE[org.industry ?? ""] ?? "construction";
  const [choice, setChoice] = useState<"starter" | "ai" | "file">("starter");
  const [tpl, setTpl] = useState(suggested);
  const [existing, setExisting] = useState<PlanSummary[] | null>(null);
  useEffect(() => { api.plans().then((r) => setExisting(r.plans.filter((p) => p.workspace_id === ws))).catch(() => setExisting([])); }, [ws]);
  const t = TEMPLATES.find((x) => x.id === tpl)!;
  const first = existing?.find((p) => p.id === org.onboarding.firstPlanId) ?? existing?.[0];
  return (
    <Frame
      step="first" kicker="FIRST PROJECT" title="Make your first plan (2 minutes)"
      lead={`It goes into the ${org.workspaces[0]!.name} workspace, where everyone you invite can see it.`}
      back={() => void goTo("rules")}
      alt={<Button variant="ghost" onClick={() => void goTo("live", first ? { firstPlanId: first.id } : {})}>{first ? "Keep this plan" : "Skip for now"}</Button>}
      nextLabel={choice === "starter" ? `Make "${t.name}"` : "Open"}
      next={async () => {
        if (choice !== "starter") { await api.saveOnboarding(org.id, { step: "live" }); go(`/new?ws=${encodeURIComponent(ws)}`); return; }
        const made = await api.createPlan(templateText(t.id, todayLocal(), t.id === "blank" ? "First plan" : t.name), {}, undefined, ws);
        await goTo("live", { firstPlanId: made.id });
      }}
    >
      {first && <Notice tone="good">Already made: <Link to={`/p/${first.id}`} className="font-semibold underline">{first.title}</Link>. Make another, or keep this one.</Notice>}
      <div role="radiogroup" aria-label="First plan" className="flex flex-col gap-2">
        <Choice name="first" checked={choice === "starter"} onPick={() => setChoice("starter")} label={`Start from "${t.name}"`} hint={t.blurb} />
        {choice === "starter" && (
          <label className="ml-8 flex flex-col gap-1.5 text-sm font-semibold">Or another template
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} className={input}>{TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
        )}
        <Choice name="first" checked={choice === "ai"} onPick={() => setChoice("ai")} label="Use my AI assistant" hint="Paste our prompt into a chat where you planned something." />
        <Choice name="first" checked={choice === "file"} onPick={() => setChoice("file")} label="Import a plan file or spreadsheet" hint="From another planning tool, a spreadsheet, or a plan file." />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- 6. go live

function LiveStep({ me, org, goTo, reload }: StepProps) {
  const { go } = useRouter();
  const [dry, setDry] = useState<{ willInvite: OrgInviteCheck[]; skipped: OrgInviteCheck[] } | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [result, setResult] = useState<{ invited: { email: string; name: string | null; role: string; link: string }[]; skipped: OrgInviteCheck[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!org.onboarding.done) api.goLive(org.id, true).then((r) => setDry({ willInvite: r.willInvite ?? [], skipped: r.skipped })).catch((e: Error) => setError(e.message));
    api.plans().then((r) => setPlans(r.plans.filter((p) => p.workspace_id === org.workspaces[0]?.id))).catch(() => {});
  }, [org.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = plans.find((p) => p.id === org.onboarding.firstPlanId) ?? plans[0];
  const domain = org.domains[0];

  if (result || org.onboarding.done) {
    return (
      <Frame step="live" kicker="YOU'RE LIVE" title={`${org.name} is live`}>
        {result && result.invited.length > 0 && (
          <>
            <p className="m-0 text-[15px] text-ink-2">Each person's invite email waits in the outbox until email sending is switched on. Until then, send them their link yourself. Each link works once, for that address, for 7 days.</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Invite links">
              {result.invited.map((i) => (
                <li key={i.email} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
                  <span className="min-w-0 flex-1"><strong>{i.name || i.email}</strong><span className="block truncate text-sm text-ink-2">{i.email} · {ROLE_WORD[i.role as OrgRole] ?? i.role}</span></span>
                  <CopyButton text={i.link} label="Copy link" />
                </li>
              ))}
            </ul>
          </>
        )}
        {result && result.skipped.length > 0 && <Notice tone="warn">Not invited: {result.skipped.map((s) => `${s.email || "a row"} (${s.problem?.replace(/\.$/, "")})`).join("; ")}.</Notice>}
        {!result && <Notice tone="good">Setup is finished.</Notice>}
        <Note title="After today" tone="good">To add someone later, or change who can do what, use the admin console. It works the same on a computer and on your phone.</Note>
        <div className="flex flex-wrap gap-2">
          {first && <Button onClick={() => go(`/p/${first.id}`)}>Open {first.title}</Button>}
          <Button variant="secondary" onClick={() => go("/")}>Go to Home</Button>
        </div>
      </Frame>
    );
  }

  const admins = (org.onboarding.people ?? []).filter((p) => p.role === "admin");
  const sample = dry?.willInvite[0];
  const checklist = [
    "People sign in with the work email address you invited.",
    dry ? (dry.willInvite.length ? `${plural(dry.willInvite.length, "person", "people")} get an invite link when you press Go live.` : "No one to invite yet. You can add people any time.") : "Checking your people list…",
    domain ? (domain.verified ? `${domain.domain} is verified.` : `${domain.domain} isn't verified yet. You can check again later.`) : "No domain added. You can add one later.",
    admins.length ? `Second admin: ${admins.map((a) => a.name || a.email).join(", ")}` : "Only you are an admin. You can add another later.",
    `Rules: ${RULES[org.rules.preset].label.replace(" (recommended)", "")}`,
    first ? `First plan: ${first.title}, ready to edit` : "No plan yet. Make one any time.",
  ];
  return (
    <Frame
      step="live" kicker="GO LIVE" title={`${org.name} is ready`}
      lead="Nothing has gone to employees yet. Check the list, then press Go live."
      error={error}
      back={() => void goTo("first")}
      nextLabel="Go live"
      nextDisabled={!dry}
      next={async () => {
        const r = await api.goLive(org.id, false);
        setResult({ invited: r.invited ?? [], skipped: r.skipped });
        await reload();
      }}
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Checklist">
        {checklist.map((c) => <li key={c} className="flex items-start gap-2 text-[15px]"><Check aria-hidden size={18} className="mt-0.5 shrink-0 text-good" />{c}</li>)}
      </ul>
      {dry && dry.skipped.length > 0 && <Notice tone="warn">{plural(dry.skipped.length, "row")} won't be invited: {dry.skipped.map((s) => `${s.email || "a row"} (${s.problem?.replace(/\.$/, "")})`).join("; ")}. Go back to People to fix them, or go live without them.</Notice>}
      {sample && (
        <section aria-label="Invite email preview" className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
          <p className="m-0 text-sm text-muted">Invite email preview, as {sample.name || sample.email} gets it</p>
          <p className="m-0 text-[15px]"><strong>Subject:</strong> {me.user.name} invited you to {org.name} on {BRAND.name}</p>
          <p className="m-0 text-[15px]">{me.user.name} invited you to join {org.name} on {BRAND.name} as {ROLE_WORD[sample.role]}.</p>
          <span className="self-start rounded-xl bg-primary px-4 py-2.5 text-[15px] font-semibold text-white dark:text-ground">Join {org.name}</span>
          <p className="m-0 text-sm text-ink-2">The link works once, for {sample.email}, for 7 days.</p>
        </section>
      )}
      <div className="flex flex-col gap-2">
        <strong className="text-[15px]">What your employees see</strong>
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
          {[["One email", "With a single button. No password to create."], ["Sign in", "With the work email you invited."], ["Their workspace", "The company's plans, their own tasks first."]].map(([t, b], i) => (
            <li key={t} className="flex gap-2 rounded-xl bg-surface p-3 ring-1 ring-line"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-ink">{i + 1}</span><span className="flex flex-col"><strong className="text-[15px]">{t}</strong><span className="text-sm text-ink-2">{b}</span></span></li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}
