/**
 * New plan: get the prompt (for a chat that already discussed the project, or from the plan
 * wizard), paste or upload the reply, check the preview, say who has how much time, save.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Check, ClipboardCopy, Copy, FileUp, LayoutTemplate, MessagesSquare, PencilLine, Sparkles } from "lucide-react";
import { BRAND, FILE_EXTENSIONS, generatePrompt, pastPlanText, TEMPLATES, templateText, WIZARD_QUESTIONS, wizardPrompt, type WizardAnswers } from "@rakuplan/shared";
import { api, ApiError, type ImportPreview, type Me, type People, type PlanSummary } from "../lib/api";
import { longDate, plural } from "../lib/format";
import { useRouter } from "../lib/router";
import { HoursPicker } from "../ui/HoursPicker";
import { Button, Card, Notice, PageTitle } from "../ui/kit";

type Step = "start" | "conversation" | "wizard" | "paste" | "template" | "past" | "preview";
const MAX_FILE = 1_000_000;

export function NewPlan({ me }: { me: Me }) {
  const { go } = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [prompt, setPrompt] = useState("");
  const [fromWizard, setFromWizard] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [people, setPeople] = useState<People>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fullTime = me.workspaces[0]?.work_week.hoursPerWeek ?? 40;

  const check = async (body = text) => {
    setError("");
    setBusy(true);
    try {
      setText(body);
      setPreview(await api.preview(body, {}, fileName));
      setPeople({});
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (withPeople: People) => {
    setError("");
    setBusy(true);
    try {
      const r = await api.createPlan(text, withPeople, fileName);
      go(`/p/${r.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  };

  const back = (to: Step) => () => { setError(""); setStep(to); };

  return (
    <>
      <PageTitle title="New plan" sub={step === "start" ? "Most people start from a chat where they've already talked the project through." : undefined} />
      {error && <Notice tone="bad">{error}</Notice>}
      {step === "start" && <Start onPick={(s) => { setFromWizard(false); if (s === "conversation") setPrompt(generatePrompt({ source: "conversation" })); setStep(s); }} />}
      {step === "conversation" && <Conversation prompt={prompt} setPrompt={setPrompt} fromWizard={fromWizard} onBack={back("start")} onNext={() => setStep("paste")} />}
      {step === "wizard" && <Wizard onBack={back("start")} onDone={(p) => { setFromWizard(true); setPrompt(p); setStep("conversation"); }} />}
      {step === "template" && <TemplatePicker busy={busy} onBack={back("start")} onPick={(body) => { setFileName(undefined); void check(body); }} />}
      {step === "past" && <PastPicker busy={busy} onBack={back("start")} onPick={(body) => { setFileName(undefined); void check(body); }} setError={setError} />}
      {step === "paste" && <Paste text={text} setText={setText} fileName={fileName} setFileName={setFileName} busy={busy} onBack={back(prompt ? "conversation" : "start")} onCheck={() => void check()} setError={setError} />}
      {step === "preview" && preview && <Preview preview={preview} text={text} fileName={fileName} people={people} setPeople={setPeople} fullTime={fullTime} busy={busy} onBack={back("paste")} onSave={(p) => void save(p)} />}
    </>
  );
}

function Start({ onPick }: { onPick: (s: Step) => void }) {
  const options = [
    { s: "conversation" as const, Icon: MessagesSquare, title: "I've been talking it through with my AI", body: "Copy our prompt into that same chat. Your assistant turns the conversation into a plan; you paste its reply here." },
    { s: "wizard" as const, Icon: PencilLine, title: "I'm starting fresh", body: "Answer a few short questions. We put your answers into a prompt for any AI assistant." },
    { s: "paste" as const, Icon: FileUp, title: "I already have a reply or a plan file", body: `Paste an assistant's reply, or open a ${BRAND.fileExtensions[0]} file.` },
    { s: "template" as const, Icon: LayoutTemplate, title: "Start from a template", body: "Event, renovation, launch, hiring, research, move, wedding, construction, marketing, or blank. No AI needed." },
    { s: "past" as const, Icon: Copy, title: "Start from a past project", body: "Reuse one of your plans: same steps, fresh dates, no progress." },
  ];
  return (
    <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="How do you want to start?">
      {options.map((o) => (
        <li key={o.s}>
          <button onClick={() => onPick(o.s)} className="flex h-full w-full flex-col items-start gap-2 rounded-2xl bg-surface p-5 text-left ring-1 ring-line hover:ring-primary">
            <o.Icon aria-hidden className="text-primary" />
            <span className="text-[17px] font-bold">{o.title}</span>
            <span className="text-[15px] leading-relaxed text-ink-2">{o.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Conversation({ prompt, setPrompt, fromWizard, onBack, onNext }: { prompt: string; setPrompt: (p: string) => void; fromWizard: boolean; onBack: () => void; onNext: () => void }) {
  const [focus, setFocus] = useState("");
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!fromWizard) setPrompt(generatePrompt({ source: "conversation", ...(focus.trim() ? { focus } : {}), ...(extra.trim() ? { notes: extra } : {}) }));
    setCopied(false);
  }, [focus, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      box.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  };
  return (
    <Card className="flex flex-col gap-4">
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-relaxed text-ink-2">
        <li>Copy the prompt below.</li>
        <li>{fromWizard ? "Paste it into a new chat with any AI assistant." : "Paste it at the end of the chat where you discussed the project."}</li>
        <li>Copy the assistant's whole reply and bring it back here.</li>
      </ol>
      {!fromWizard && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Which project? <span className="font-normal text-muted">Only if that chat covers several.</span>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. the spring launch" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Anything to add? <span className="font-normal text-muted">Optional details the chat doesn't have.</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Sam joins in March" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">The prompt
        <textarea ref={box} readOnly value={prompt} rows={8} className="rounded-xl border border-line bg-surface-2 p-3 font-mono text-[13px] leading-relaxed font-normal" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}><ArrowLeft aria-hidden size={18} /> Back</Button>
        <Button onClick={() => void copy()}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy prompt</>}</Button>
        <Button variant="secondary" onClick={onNext}>I have the reply</Button>
      </div>
      <p className="m-0 text-sm text-muted">Works with any AI assistant. {BRAND.name} never sees your chat, only the reply you paste.</p>
    </Card>
  );
}

function Wizard({ onBack, onDone }: { onBack: () => void; onDone: (prompt: string) => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const q = WIZARD_QUESTIONS[i]!;
  const value = answers[q.key] ?? "";
  const last = i === WIZARD_QUESTIONS.length - 1;
  const missing = q.required && !value.trim();
  const finish = () => {
    const a: WizardAnswers = { project: answers.project ?? "" };
    for (const k of ["goal", "start", "deadline", "budget", "alreadyDone", "constraints", "other"] as const) if (answers[k]?.trim()) a[k] = answers[k]!.trim();
    const people = (answers.people ?? "").split(/\n|,/).map((s) => s.trim()).filter(Boolean).map((line) => {
      const [name, ...role] = line.split(/\s+[-:]\s+/);
      return role.length ? { name: name!.trim(), role: role.join(" ").trim() } : { name: name!.trim() };
    });
    if (people.length) a.people = people;
    onDone(wizardPrompt(a));
  };
  const next = () => (missing ? undefined : last ? finish() : setI(i + 1));
  const input = "rounded-xl border border-line bg-surface px-3 text-base";
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span>Question {i + 1} of {WIZARD_QUESTIONS.length}</span>
        {!q.required && <span>Optional</span>}
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-primary" style={{ width: `${((i + 1) / WIZARD_QUESTIONS.length) * 100}%` }} /></div>
      <label className="flex flex-col gap-2">
        <span className="text-xl font-bold">{q.question}</span>
        <span className="text-[15px] text-ink-2">{q.key === "people" ? "One person per line, like \"Jordan - contractor\". Leave empty if it's just you." : q.hint}</span>
        {q.key === "start" ? (
          <input type="date" value={value} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} className={`${input} min-h-12 self-start`} />
        ) : (
          <textarea autoFocus rows={q.key === "project" || q.key === "people" ? 4 : 2} value={value} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} className={`${input} py-2.5`} />
        )}
      </label>
      {missing && answers[q.key] !== undefined && <span className="text-sm font-semibold text-bad">Write a sentence or two about the project to continue.</span>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => (i === 0 ? onBack() : setI(i - 1))}><ArrowLeft aria-hidden size={18} /> Back</Button>
        <Button onClick={next} disabled={missing}>{last ? <><Sparkles aria-hidden size={18} /> Make my prompt</> : "Next"}</Button>
        {!q.required && !last && <Button variant="ghost" onClick={() => setI(i + 1)}>Skip</Button>}
      </div>
    </Card>
  );
}

function Paste(props: { text: string; setText: (t: string) => void; fileName: string | undefined; setFileName: (n: string | undefined) => void; busy: boolean; onBack: () => void; onCheck: () => void; setError: (e: string) => void }) {
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_FILE) return props.setError("That file is too big (over 1 MB). Plan files are usually a few kilobytes.");
    props.setError("");
    props.setText(await f.text());
    props.setFileName(f.name);
  };
  return (
    <Card className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-semibold">Paste your assistant's whole reply
        <span className="font-normal text-muted">Extra words before or after the plan are fine; we find the plan.</span>
        <textarea value={props.text} onChange={(e) => { props.setText(e.target.value); props.setFileName(undefined); }} rows={12} placeholder="Paste here" className="rounded-xl border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed font-normal" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[15px] font-semibold hover:bg-surface-2">
          <FileUp aria-hidden size={18} /> Open a file
          <input type="file" accept={[...FILE_EXTENSIONS, ".md", ".txt"].join(",")} onChange={(e) => void onFile(e)} className="sr-only" />
        </label>
        {props.fileName && <span className="text-sm text-ink-2">Opened {props.fileName}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={props.onBack}><ArrowLeft aria-hidden size={18} /> Back</Button>
        <Button onClick={props.onCheck} disabled={!props.text.trim() || props.busy}>{props.busy ? "Checking…" : "Check my plan"}</Button>
      </div>
    </Card>
  );
}

function Preview(props: { preview: ImportPreview; text: string; fileName: string | undefined; people: People; setPeople: (p: People) => void; fullTime: number; busy: boolean; onBack: () => void; onSave: (p: People) => void }) {
  const { preview, people, setPeople } = props;
  const [live, setLive] = useState<ImportPreview>(preview);
  const [updating, setUpdating] = useState(false);
  const plan = preview.plan;
  const tasks = useMemo(() => plan.phases.flatMap((p) => p.tasks), [plan]);
  const counted = tasks.filter((t) => !t.milestone);
  const done = counted.filter((t) => t.status === "done").length;
  // The finish date updates as availability is typed (the server runs the same scheduler).
  useEffect(() => {
    if (!Object.keys(people).length) return setLive(preview);
    setUpdating(true);
    const t = setTimeout(() => {
      api.preview(props.text, people, props.fileName).then(setLive).catch(() => {}).finally(() => setUpdating(false));
    }, 300);
    return () => clearTimeout(t);
  }, [people]); // eslint-disable-line react-hooks/exhaustive-deps
  const setHours = (name: string, h: number) => setPeople({ ...people, [name]: { ...people[name], hoursPerWeek: h } });
  const addOff = (name: string, start: string, end: string) => setPeople({ ...people, [name]: { ...people[name], timeOff: [...(people[name]?.timeOff ?? []), { start, end }] } });
  const removeOff = (name: string, i: number) => setPeople({ ...people, [name]: { ...people[name], timeOff: (people[name]?.timeOff ?? []).filter((_, j) => j !== i) } });
  const solo = preview.people.length <= 1;
  const findings = live.check.findings.slice(0, 5);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card aria-label="Your plan" className="flex flex-col gap-3">
        <span className="text-xs font-bold tracking-wide text-primary-ink uppercase">Preview · not saved yet</span>
        <h2 className="m-0 text-xl font-bold">{plan.title}</h2>
        {plan.goal && <p className="m-0 text-[15px] text-ink-2">{plan.goal}</p>}
        <p className="m-0 text-[15px]">{plural(plan.phases.length, "phase")} · {plural(counted.length, "task")}{done ? ` · ${done} already done` : ""} · {plural(tasks.filter((t) => t.milestone).length, "milestone")}</p>
        <div className="rounded-xl bg-surface-2 p-3">
          <span className="text-sm text-muted">Finish</span>
          <p className="m-0 text-2xl font-bold" aria-live="polite">{longDate(live.finish)}{updating && <span className="ml-2 text-sm font-normal text-muted">updating…</span>}</p>
        </div>
        {preview.notices.map((n) => <Notice key={n} tone="info">{n}</Notice>)}
        {preview.moderation === "review" && <Notice tone="warn">This plan will be saved privately and checked by our safety team before it can be shared.</Notice>}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><h3 className="m-0 text-base font-bold">Plan Check</h3><span className="text-sm font-bold text-good">{live.check.score} / 100</span></div>
          {findings.length === 0 && <p className="m-0 text-sm text-ink-2">No problems found.</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {findings.map((f, i) => (
              <li key={i} className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${f.severity === "problem" ? "bg-bad-soft text-bad" : f.severity === "warning" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>
                <span className="font-bold">{f.severity === "problem" ? "Problem: " : f.severity === "warning" ? "Check: " : "Tip: "}</span>{f.message}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card aria-label="Availability" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-bold">{solo ? "How much time can you give this each week?" : "How much time can each person give this project?"}</h2>
          <p className="m-0 text-sm text-ink-2">Dates are only right if they know who's free. Skip this and everyone counts as full time ({props.fullTime} h/week); you can change it later.</p>
        </div>
        {(preview.people.length ? preview.people : ["You"]).map((name) => (
          <PersonRow key={name} name={name} fullTime={props.fullTime} hours={people[name]?.hoursPerWeek} timeOff={people[name]?.timeOff ?? []} onHours={(h) => setHours(name, h)} onAddOff={(s, e) => addOff(name, s, e)} onRemoveOff={(i) => removeOff(name, i)} />
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={props.onBack}><ArrowLeft aria-hidden size={18} /> Back</Button>
          <Button onClick={() => props.onSave(people)} disabled={props.busy}>{props.busy ? "Saving…" : "Save plan"}</Button>
          {Object.keys(people).length === 0 && <Button variant="ghost" onClick={() => props.onSave({})} disabled={props.busy}>Skip for now</Button>}
        </div>
      </Card>
    </div>
  );
}

function PersonRow(props: { name: string; fullTime: number; hours: number | undefined; timeOff: { start: string; end: string }[]; onHours: (h: number) => void; onAddOff: (s: string, e: string) => void; onRemoveOff: (i: number) => void }) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const ok = start && end && start <= end;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <span className="text-[15px] font-bold">{props.name}</span>
      <HoursPicker label={`Hours a week for ${props.name}`} value={props.hours} fullTime={props.fullTime} onChange={props.onHours} />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Any days off coming up?</span>
        {props.timeOff.map((t, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span>{longDate(t.start)}{t.end !== t.start ? ` to ${longDate(t.end)}` : ""}</span>
            <button onClick={() => props.onRemoveOff(i)} className="min-h-10 rounded-lg px-2 font-semibold text-primary-ink">Remove</button>
          </div>
        ))}
        {adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">First day off<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end) setEnd(e.target.value); }} className="min-h-11 rounded-xl border border-line bg-surface px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">Last day off<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-2" /></label>
            <Button variant="secondary" disabled={!ok} onClick={() => { props.onAddOff(start, end); setAdding(false); setStart(""); setEnd(""); }}>Add</Button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="min-h-11 self-start rounded-xl px-1 text-sm font-semibold text-primary-ink underline underline-offset-4">+ Add days off</button>
        )}
      </div>
    </div>
  );
}



const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function StartFields({ title, setTitle, start, setStart }: { title: string; setTitle: (s: string) => void; start: string; setStart: (s: string) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Plan name<input value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
    </div>
  );
}

function TemplatePicker({ busy, onBack, onPick }: { busy: boolean; onBack: () => void; onPick: (text: string) => void }) {
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(todayLocal());
  const chosen = TEMPLATES.find((t) => t.id === id);
  return (
    <Card className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Templates" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button key={t.id} role="radio" aria-checked={id === t.id} onClick={() => { setId(t.id); setTitle(t.id === "blank" ? "" : t.name); }} className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left ring-1 ${id === t.id ? "bg-primary-soft ring-2 ring-primary" : "bg-surface ring-line hover:bg-surface-2"}`}>
            <span className="text-[15px] font-bold">{t.name}</span><span className="text-sm text-ink-2">{t.blurb}</span>
          </button>
        ))}
      </div>
      {chosen && <StartFields title={title} setTitle={setTitle} start={start} setStart={setStart} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}><ArrowLeft aria-hidden size={18} /> Back</Button>
        <Button disabled={!chosen || !start || busy || (chosen.id === "blank" && !title.trim())} onClick={() => onPick(templateText(chosen!.id, start, title))}>{busy ? "Checking…" : "Preview"}</Button>
      </div>
    </Card>
  );
}

function PastPicker({ busy, onBack, onPick, setError }: { busy: boolean; onBack: () => void; onPick: (text: string) => void; setError: (e: string) => void }) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(todayLocal());
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch((e: Error) => setError(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    try {
      const d = await api.plan(id!);
      onPick(pastPlanText(d.plan, { title, start }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that plan.");
    }
  };
  return (
    <Card className="flex flex-col gap-4">
      {plans?.length === 0 && <p className="m-0 text-[15px] text-ink-2">You don't have any plans yet. Start another way first.</p>}
      <div role="radiogroup" aria-label="Your plans" className="grid gap-2 md:grid-cols-2">
        {plans?.map((p) => (
          <button key={p.id} role="radio" aria-checked={id === p.id} onClick={() => { setId(p.id); setTitle(`${p.title} (copy)`); }} className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left ring-1 ${id === p.id ? "bg-primary-soft ring-2 ring-primary" : "bg-surface ring-line hover:bg-surface-2"}`}>
            <span className="text-[15px] font-bold">{p.title}</span>{p.summary && <span className="text-sm text-ink-2">{p.summary.countedTasks} tasks · {p.summary.health}</span>}
          </button>
        ))}
      </div>
      {id && <StartFields title={title} setTitle={setTitle} start={start} setStart={setStart} />}
      <p className="m-0 text-sm text-muted">The copy keeps the phases, tasks, owners and time needed. Progress, dates and "Done by" start fresh; the original isn't changed.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}><ArrowLeft aria-hidden size={18} /> Back</Button>
        <Button disabled={!id || !start || busy} onClick={() => void go()}>{busy ? "Checking…" : "Preview"}</Button>
      </div>
    </Card>
  );
}
