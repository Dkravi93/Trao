"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type User = { id: string; email: string };
type Requirement = { id: string; text: string; kind: string; priority: "must" | "nice" };
type Question = { id: string; category: string; prompt: string; answer_outline: string; difficulty: number; requirement_ids: string[] };
type Flashcard = { id: string; front: string; back: string; requirement_ids: string[] };
type Kit = { source: { company: string; role: string }; company_brief: { summary: string; what_they_do: string; sources: string[] }; role: { requirements: Requirement[] }; questions: Question[]; flashcards: Flashcard[]; schedule: { days: { day: number; focus: string; question_ids: string[]; minutes: number }[] }; coverage: { uncovered_requirement_ids: string[] }; research?: { warnings: string[] } };
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
      {card && <div className="mt-4 rounded-xl border border-slate-200 p-5"><p className="font-semibold">{card.front}</p>{revealed ? <p className="mt-5 text-slate-600">{card.back}</p> : <button type="button" onClick={() => setRevealed(true)} className="mt-5 rounded-lg border px-3 py-2 text-sm">Reveal answer</button>}<div className="mt-5 flex flex-wrap gap-2" aria-label="Confidence rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => void rate(value)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-indigo-100">{value} {value === 1 ? "Need work" : value === 5 ? "Solid" : ""}</button>)}</div></div>}
    </article>
    <article className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold">Weak spots</h3><p className="mt-1 text-sm text-slate-500">Requirements to revisit before the interview.</p>{weakRequirements.length ? <ul className="mt-3 space-y-2">{weakRequirements.map((requirement) => <li key={requirement.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{requirement.text}</li>)}</ul> : <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">No weak spots yet.</p>}</article>
  </section>;
}

function KitDetail({ record }: { record: KitRecord }) {
  if (record.status === "generating") return <section className="rounded-2xl bg-white p-7 shadow-sm" aria-live="polite"><h2 className="text-2xl font-bold">Building your kit</h2><p className="mt-2 text-slate-600">We’re reading the description, researching the company, checking coverage, and creating your schedule. This page updates automatically.</p></section>;
  if (record.status === "failed") return <section className="rounded-2xl border border-red-200 bg-red-50 p-7"><h2 className="text-2xl font-bold text-red-900">Generation could not finish</h2><p className="mt-2 text-red-800">{record.error?.message}</p></section>;
  const kit = record.kit; if (!kit) return null;
  const groups = kit.questions.reduce<Array<[string, Question[]]>>((result, question) => {
    const group = result.find(([category]) => category === question.category);
    if (group) group[1].push(question);
    else result.push([question.category, [question]]);
    return result;
  }, []);
  return <section className="space-y-5"><div className="rounded-2xl bg-slate-950 p-7 text-white"><p className="text-sm font-semibold text-indigo-300">{kit.source.company}</p><h2 className="mt-1 text-3xl font-bold">{kit.source.role}</h2><p className="mt-4 max-w-3xl text-slate-300">{kit.company_brief.summary}</p></div>{kit.research?.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Research note: {warning}</p>)}<Practice record={record} kit={kit} /><div className="grid gap-5 lg:grid-cols-2"><article className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold">Role requirements</h3><ul className="mt-3 space-y-2">{kit.role.requirements.map((requirement) => <li key={requirement.id} className="rounded-lg bg-slate-50 p-3"><span className={requirement.priority === "must" ? "font-semibold text-indigo-700" : "text-slate-500"}>{requirement.priority.toUpperCase()}</span><p>{requirement.text}</p></li>)}</ul></article><article className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold">Study schedule</h3><ol className="mt-3 space-y-2">{kit.schedule.days.map((day) => <li key={day.day} className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Day {day.day}: {day.focus}</span><span className="text-slate-500">{day.minutes} min</span></li>)}</ol></article></div>{groups.map(([category, questions]) => <article key={category} className="rounded-2xl bg-white p-5 shadow-sm"><h3 className="font-bold capitalize">{category} questions</h3><div className="mt-3 space-y-3">{questions?.map((question) => <details key={question.id} className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-medium">{question.prompt}</summary><p className="mt-3 text-slate-600">{question.answer_outline}</p></details>)}</div></article>)}</section>;
}

function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [kits, setKits] = useState<KitRecord[]>([]); const [selected, setSelected] = useState<string | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => { try { const data = await payload(await api("/kits")); setKits(data.kits); setSelected((current) => current ?? data.kits[0]?.id ?? null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load kits."); } }, []);
  useEffect(() => { void load(); }, [load]);
  const generating = kits.some((kit) => kit.status === "generating"); useEffect(() => { if (!generating) return; const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer); }, [generating, load]);
  const active = useMemo(() => kits.find((kit) => kit.id === selected) ?? null, [kits, selected]);
  async function signOut() { await api("/auth/logout", { method: "POST" }); onSignOut(); }
  return <main className="min-h-screen"><header className="flex items-center justify-between border-b bg-white px-5 py-4 md:px-10"><div><p className="text-sm font-bold text-indigo-600">TRAO PREP</p><p className="text-sm text-slate-500">{user.email}</p></div><button onClick={() => void signOut()} className="rounded-lg border px-3 py-2 text-sm">Sign out</button></header><div className="mx-auto grid max-w-7xl gap-6 p-5 lg:grid-cols-[360px_1fr] lg:p-10"><aside className="space-y-5"><CreateKit onCreated={(kit) => { setKits((current) => [kit, ...current.filter((item) => item.id !== kit.id)]); setSelected(kit.id); }} /><BatchUpload onCreated={(newKits) => { setKits((current) => [...newKits, ...current.filter((item) => !newKits.some((newKit: KitRecord) => newKit.id === item.id))]); setSelected(newKits[0]?.id ?? null); }} /><nav className="rounded-2xl bg-white p-3 shadow-sm" aria-label="Your kits"><h2 className="px-2 py-2 font-bold">Your kits</h2>{kits.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No kits yet.</p>}{kits.map((kit) => <button key={kit.id} onClick={() => setSelected(kit.id)} className={`mb-1 w-full rounded-xl p-3 text-left ${kit.id === selected ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"}`}><p className="font-medium">{kit.kit?.source.role ?? "New preparation kit"}</p><p className="text-xs text-slate-500">{kit.status}</p></button>)}</nav></aside><div>{error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : active ? <KitDetail record={active} /> : <section className="rounded-2xl bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-bold">Start with a role you care about.</h1><p className="mt-2 text-slate-600">Paste a job description and we’ll turn it into a focused plan.</p></section>}</div></div></main>;
}

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { void api("/auth/me").then(payload).then((data) => setUser(data.user)).catch(() => setUser(null)); }, []);
  if (user === undefined) return <main className="grid min-h-screen place-items-center">Loading Trao Prep…</main>;
  return user ? <Dashboard user={user} onSignOut={() => setUser(null)} /> : <Auth onSignedIn={setUser} />;
}
