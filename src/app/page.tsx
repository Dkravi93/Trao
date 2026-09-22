"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type User = { id: string; email: string };
type Requirement = { id: string; text: string; kind: string; priority: "must" | "nice" };
type Question = { id: string; category: string; prompt: string; answer_outline: string; difficulty: number; requirement_ids: string[]; pinned?: boolean };
type Flashcard = { id: string; front: string; back: string; requirement_ids: string[]; pinned?: boolean };
type Kit = { source: { company: string; role: string }; company_brief: { summary: string; what_they_do: string; sources: string[]; pinned?: boolean }; role: { requirements: Requirement[] }; questions: Question[]; flashcards: Flashcard[]; schedule: { days: { day: number; focus: string; question_ids: string[]; minutes: number }[] }; coverage: { uncovered_requirement_ids: string[] }; research?: { warnings: string[] } };
type KitRecord = { id: string; status: "generating" | "ready" | "failed"; kit: Kit | null; error: { code: string; message: string } | null; updated_at: string };

async function api(path: string, init: RequestInit = {}, refresh = true): Promise<Response> {
  const response = await fetch(`${apiBase}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...init.headers } });
  if (response.status === 401 && refresh && path !== "/auth/refresh") {
    const renewed = await fetch(`${apiBase}/auth/refresh`, { method: "POST", credentials: "include" });
    if (renewed.ok) return api(path, init, false);
  }
  return response;
}
async function payload(response: Response) { const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error?.message ?? "Request failed."); return value; }

function Auth({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const data = await payload(await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) })); onSignedIn(data.user); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to continue."); } finally { setBusy(false); } }
  return <main className="grid min-h-screen place-items-center p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm"><p className="mb-2 text-sm font-semibold text-indigo-600">TRAO PREP</p><h1 className="text-3xl font-bold">Interview preparation, made personal.</h1><p className="mt-3 text-slate-600">Research the company, map the role, and practise what matters.</p><label className="mt-7 block text-sm font-medium">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label><label className="mt-4 block text-sm font-medium">Password<input required minLength={12} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-6 w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white disabled:opacity-50">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button><button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 w-full text-sm text-indigo-700">{mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}</button></form></main>;
}

function CreateKit({ onCreated }: { onCreated: (kit: KitRecord) => void }) {
  const [jd, setJd] = useState(""); const [companyUrl, setCompanyUrl] = useState(""); const [days, setDays] = useState(5); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const data = await payload(await api("/kits", { method: "POST", body: JSON.stringify({ jd, company_url: companyUrl, days }) })); onCreated(data.kit); setJd(""); setCompanyUrl(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create kit."); } finally { setBusy(false); } }
  return <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Create a prep kit</h2><label className="mt-4 block text-sm font-medium">Job description<textarea required value={jd} onChange={(e) => setJd(e.target.value)} rows={7} placeholder="Paste the role description…" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label><label className="mt-3 block text-sm font-medium">Company website<input required type="url" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} placeholder="https://company.com" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label><label className="mt-3 block text-sm font-medium">Days until interview<input required min={1} max={60} type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-5 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Researching and generating…" : "Build my kit"}</button></form>;
}

function BatchUpload({ onCreated }: { onCreated: (kits: KitRecord[]) => void }) {
  const [value, setValue] = useState("[{\n  \"jd\": \"Required: TypeScript\",\n  \"company_url\": \"https://example.com\",\n  \"days\": 5\n}]");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { const data = await payload(await api("/kits/batch", { method: "POST", body: value })); onCreated(data.kits); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload batch."); } }
  return <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">Batch upload</h2><p className="mt-1 text-sm text-slate-500">Paste a JSON array of up to five role cases.</p><textarea aria-label="Batch cases JSON" value={value} onChange={(event) => setValue(event.target.value)} rows={7} className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<button className="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold">Queue batch</button></form>;
}

function Practice({ record, kit }: { record: KitRecord; kit: Kit }) {
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [active, setActive] = useState(0);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    void api(`/kits/${record.id}/progress`).then(payload).then((data) => setConfidence(data.confidence)).catch(() => undefined);
  }, [record.id]);
  const cards = [...kit.flashcards].sort((left, right) => (confidence[left.id] ?? 0) - (confidence[right.id] ?? 0));
  const card = cards[active % Math.max(cards.length, 1)];
  async function rate(value: number) {
    if (!card) return;
    setConfidence((current) => ({ ...current, [card.id]: value }));
    setRevealed(false);
    setActive((current) => current + 1);
    await api(`/kits/${record.id}/progress`, { method: "PUT", body: JSON.stringify({ card_id: card.id, confidence: value }) });
  }
  const weakRequirements = kit.role.requirements.filter((requirement) => kit.coverage.uncovered_requirement_ids.includes(requirement.id) || kit.flashcards.some((item) => item.requirement_ids.includes(requirement.id) && (confidence[item.id] ?? 0) <= 2));
  return <section className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
    <article className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="font-bold">Practice flashcards</h3><p className="text-sm text-slate-500">Low-confidence cards appear first.</p></div><span className="text-sm text-slate-500">{cards.length ? `${(active % cards.length) + 1} / ${cards.length}` : "No cards"}</span></div>
      {card && <div className="mt-4 rounded-xl border border-slate-200 p-5"><p className="font-semibold">{card.front}</p>{revealed ? <p className="mt-5 text-slate-600">{card.back}</p> : <button type="button" onClick={() => setRevealed(true)} className="mt-5 rounded-lg border px-3 py-2 text-sm">Reveal answer</button>}{revealed ? <div className="mt-5"><p className="mb-2 text-xs font-medium text-slate-500">How well did you know this?</p><div className="flex flex-wrap gap-2" aria-label="Confidence rating">{[{ value: 1, label: "Need work" }, { value: 2, label: "Shaky" }, { value: 3, label: "Okay" }, { value: 4, label: "Good" }, { value: 5, label: "Solid" }].map(({ value, label }) => <button key={value} type="button" onClick={() => void rate(value)} title={label} className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-indigo-100">{value} {label}</button>)}</div></div> : <p className="mt-3 text-xs text-slate-400">Reveal the answer to rate your confidence.</p>}</div>}
    </article>
    <article className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold">Weak spots</h3><p className="mt-1 text-sm text-slate-500">Requirements to revisit before the interview.</p>{weakRequirements.length ? <ul className="mt-3 space-y-2">{weakRequirements.map((requirement) => <li key={requirement.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{requirement.text}</li>)}</ul> : <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">No weak spots yet.</p>}</article>
  </section>;
}

function EditableText({ value, multiline = false, onSave }: { value: string; multiline?: boolean; onSave: (value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(value); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [editing, value]);
  async function save() { if (!draft.trim() || draft === value) { setEditing(false); return; } setBusy(true); try { await onSave(draft.trim()); setEditing(false); } finally { setBusy(false); } }
  if (!editing) return <button type="button" onClick={() => setEditing(true)} className="block w-full text-left hover:bg-indigo-50/50" title="Click to edit">{value}</button>;
  return <div><div className="flex gap-2">{multiline ? <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="w-full rounded-lg border border-indigo-300 bg-white p-2 text-inherit" /> : <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} className="w-full rounded-lg border border-indigo-300 bg-white p-2 text-inherit" />}</div><div className="mt-1 flex gap-2 text-xs"><button type="button" disabled={busy} onClick={() => void save()} className="font-semibold text-indigo-700">Save</button><button type="button" onClick={() => { setDraft(value); setEditing(false); }} className="text-slate-500">Cancel</button></div></div>;
}

function KitDetail({ record: initialRecord, onUpdated }: { record: KitRecord; onUpdated?: (record: KitRecord) => void }) {
  const [localRecord, setLocalRecord] = useState(initialRecord);
  const record = onUpdated ? initialRecord : localRecord;
  const applyUpdated = onUpdated ?? setLocalRecord;
  const [actionError, setActionError] = useState("");
  if (record.status === "generating") return <section className="rounded-2xl bg-white p-7 shadow-sm" aria-live="polite"><h2 className="text-2xl font-bold">Building your kit</h2><p className="mt-2 text-slate-600">We’re reading the description, researching the company, checking coverage, and creating your schedule. This page updates automatically.</p></section>;
  if (record.status === "failed") return <section className="rounded-2xl border border-red-200 bg-red-50 p-7"><h2 className="text-2xl font-bold text-red-900">Generation could not finish</h2><p className="mt-2 text-red-800">{record.error?.message}</p></section>;
  const kit = record.kit; if (!kit) return null;
  const currentKit = kit;
  const groups = kit.questions.reduce<Array<[string, Question[]]>>((result, question) => {
    const group = result.find(([category]) => category === question.category);
    if (group) group[1].push(question);
    else result.push([question.category, [question]]);
    return result;
  }, []);
  async function runMutation(request: () => Promise<Response>) {
    setActionError("");
    try { const data = await payload(await request()); applyUpdated(data.kit); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "The change could not be saved."; setActionError(message); window.alert(message); }
  }
  async function update(path: string, body: object) { await runMutation(() => api(`/kits/${record.id}${path}`, { method: "PATCH", body: JSON.stringify(body) })); }
  async function create(path: string, body: object) { await runMutation(() => api(`/kits/${record.id}${path}`, { method: "POST", body: JSON.stringify(body) })); }
  async function remove(path: string) { await runMutation(() => api(`/kits/${record.id}${path}`, { method: "DELETE" })); }
  async function reorder(questions: Question[]) { await runMutation(() => api(`/kits/${record.id}/questions`, { method: "PUT", body: JSON.stringify({ questions }) })); }
  async function regenerate(body: { target: "brief" | "category" | "schedule"; category?: string; force?: boolean }) {
    setActionError("");
    try { const data = await payload(await api(`/kits/${record.id}/regenerate`, { method: "POST", body: JSON.stringify(body) })); applyUpdated(data.kit); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "The section could not be regenerated.";
      if (body.target === "brief" && message.includes("manual edits")) {
        if (window.confirm("This brief contains manual edits. Replace them with newly generated content?")) {
          await runMutation(() => api(`/kits/${record.id}/regenerate`, { method: "POST", body: JSON.stringify({ ...body, force: true }) }));
        }
        return;
      }
      setActionError(message); window.alert(message);
    }
  }
    async function addQuestion(category: string) {
      const prompt = window.prompt("Question prompt");
      if (!prompt?.trim()) return;
      const requirement = currentKit.role.requirements.find((item) => item.kind === (category === "behavioural" ? "behavioural" : category === "system-design" ? "domain" : "technical")) ?? currentKit.role.requirements[0];
      if (requirement) await create("/questions", { category, prompt: prompt.trim(), answer_outline: "", difficulty: 1, requirement_ids: [requirement.id] });
    }
    async function addFlashcard() {
      const front = window.prompt("Flashcard front"); const back = front ? window.prompt("Flashcard back") : null;
      if (!front?.trim() || !back?.trim()) return;
      const requirement = currentKit.role.requirements[0];
      if (requirement) await create("/flashcards", { front: front.trim(), back: back.trim(), requirement_ids: [requirement.id] });
    }
      function moveQuestion(questionId: string, offset: number) {
        const index = currentKit.questions.findIndex((question) => question.id === questionId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= currentKit.questions.length) return;
        const questions = [...currentKit.questions];
        const current = questions[index];
        const destination = questions[target];
        if (!current || !destination) return;
        questions[index] = destination;
        questions[target] = current;
        void reorder(questions);
      }
    return <section className="space-y-5">
      {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
      <div className="rounded-2xl bg-slate-950 p-7 text-white"><p className="text-sm font-semibold text-indigo-300">{kit.source.company}</p><h2 className="mt-1 text-3xl font-bold">{kit.source.role}</h2><EditableText value={kit.company_brief.summary} multiline onSave={(value) => update("/brief", { summary: value })} /><EditableText value={kit.company_brief.what_they_do} onSave={(value) => update("/brief", { what_they_do: value })} /><button type="button" onClick={() => void regenerate({ target: "brief" })} className="mt-3 text-xs text-indigo-300">Regenerate brief</button></div>
      {kit.research?.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Research note: {warning}</p>)}<Practice record={record} kit={kit} />
      <div className="grid gap-5 lg:grid-cols-2"><article className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold">Role requirements</h3><ul className="mt-3 space-y-2">{kit.role.requirements.map((requirement) => <li key={requirement.id} className="rounded-lg bg-slate-50 p-3"><span className={requirement.priority === "must" ? "font-semibold text-indigo-700" : "text-slate-500"}>{requirement.priority.toUpperCase()}</span><p>{requirement.text}</p></li>)}</ul></article><article className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-bold">Study schedule</h3><button type="button" onClick={() => void regenerate({ target: "schedule" })} className="text-xs text-indigo-700">Regenerate</button></div><ol className="mt-3 space-y-2">{kit.schedule.days.map((day) => <li key={day.day} className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Day {day.day}: {day.focus}</span><span className="text-slate-500">{day.minutes} min</span></li>)}</ol></article></div>
      {groups.map(([category, questions]) => <article key={category} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-bold capitalize">{category} questions</h3><div className="flex gap-3"><button type="button" onClick={() => void addQuestion(category)} className="text-xs text-indigo-700">Add</button><button type="button" onClick={() => void regenerate({ target: "category", category })} className="text-xs text-indigo-700">Regenerate</button></div></div><div className="mt-3 space-y-3">{questions?.map((question) => <details key={question.id} className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-medium"><EditableText value={question.prompt} onSave={(value) => update(`/questions/${question.id}`, { prompt: value })} /></summary><div className="mt-3 text-slate-600"><EditableText value={question.answer_outline} multiline onSave={(value) => update(`/questions/${question.id}`, { answer_outline: value })} /></div><div className="mt-3 flex items-center gap-3 text-xs"><button type="button" onClick={() => moveQuestion(question.id, -1)} className="text-indigo-700">Move up</button><button type="button" onClick={() => moveQuestion(question.id, 1)} className="text-indigo-700">Move down</button><label className="text-slate-500">Category<select value={question.category} onChange={(event) => void reorder(kit.questions.map((item) => item.id === question.id ? { ...item, category: event.target.value } : item))} className="ml-1 rounded border p-1 text-slate-700"><option value="technical">Technical</option><option value="behavioural">Behavioural</option><option value="system-design">System design</option><option value="company-fit">Company fit</option></select></label></div><button type="button" onClick={() => void remove(`/questions/${question.id}`)} className="mt-3 text-xs text-red-600">Delete question</button></details>)}</div></article>)}
      <article className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-bold">Flashcards</h3><button type="button" onClick={() => void addFlashcard()} className="text-xs text-indigo-700">Add</button></div><div className="mt-3 grid gap-3 md:grid-cols-2">{kit.flashcards.map((card) => <div key={card.id} className="rounded-xl border border-slate-200 p-4"><EditableText value={card.front} onSave={(value) => update(`/flashcards/${card.id}`, { front: value })} /><div className="mt-2 text-sm text-slate-600"><EditableText value={card.back} multiline onSave={(value) => update(`/flashcards/${card.id}`, { back: value })} /></div><button type="button" onClick={() => void remove(`/flashcards/${card.id}`)} className="mt-3 text-xs text-red-600">Delete flashcard</button></div>)}</div></article>
    </section>;
}

function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [kits, setKits] = useState<KitRecord[]>([]); const [selected, setSelected] = useState<string | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => { try { const data = await payload(await api("/kits")); setKits(data.kits); setSelected((current) => current ?? data.kits[0]?.id ?? null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load kits."); } }, []);
  useEffect(() => { void load(); }, [load]);
  const generating = kits.some((kit) => kit.status === "generating"); useEffect(() => { if (!generating) return; const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer); }, [generating, load]);
  const active = useMemo(() => kits.find((kit) => kit.id === selected) ?? null, [kits, selected]);
  async function signOut() { await api("/auth/logout", { method: "POST" }); onSignOut(); }
  async function deleteKit(id: string) {
    if (!window.confirm("Delete this kit? This can't be undone.")) return;
    try {
      await payload(await api(`/kits/${id}`, { method: "DELETE" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete kit.");
      return;
    }
    setKits((current) => current.filter((kit) => kit.id !== id));
    setSelected((current) => (current === id ? null : current));
  }
  return <main className="min-h-screen"><header className="flex items-center justify-between border-b bg-white px-5 py-4 md:px-10"><div><p className="text-sm font-bold text-indigo-600">TRAO PREP</p><p className="text-sm text-slate-500">{user.email}</p></div><button onClick={() => void signOut()} className="rounded-lg border px-3 py-2 text-sm">Sign out</button></header><div className="mx-auto grid max-w-7xl gap-6 p-5 lg:grid-cols-[360px_1fr] lg:p-10"><aside className="space-y-5"><CreateKit onCreated={(kit) => { setKits((current) => [kit, ...current.filter((item) => item.id !== kit.id)]); setSelected(kit.id); }} /><BatchUpload onCreated={(newKits) => { setKits((current) => [...newKits, ...current.filter((item) => !newKits.some((newKit: KitRecord) => newKit.id === item.id))]); setSelected(newKits[0]?.id ?? null); }} /><nav className="rounded-2xl bg-white p-3 shadow-sm" aria-label="Your kits"><h2 className="px-2 py-2 font-bold">Your kits</h2>{kits.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No kits yet.</p>}{kits.map((kit) => <div key={kit.id} className={`mb-1 flex items-center gap-1 rounded-xl ${kit.id === selected ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"}`}><button onClick={() => setSelected(kit.id)} className="flex-1 p-3 text-left"><p className="font-medium">{kit.kit?.source.role ?? "New preparation kit"}</p><p className="text-xs text-slate-500">{kit.status}</p></button><button onClick={() => void deleteKit(kit.id)} aria-label="Delete kit" title="Delete kit" className="mr-2 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button></div>)}</nav></aside><div>{error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : active ? <KitDetail record={active} /> : <section className="rounded-2xl bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-bold">Start with a role you care about.</h1><p className="mt-2 text-slate-600">Paste a job description and we’ll turn it into a focused plan.</p></section>}</div></div></main>;
}

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { void api("/auth/me").then(payload).then((data) => setUser(data.user)).catch(() => setUser(null)); }, []);
  if (user === undefined) return <main className="grid min-h-screen place-items-center">Loading Trao Prep…</main>;
  return user ? <Dashboard user={user} onSignOut={() => setUser(null)} /> : <Auth onSignedIn={setUser} />;
}
