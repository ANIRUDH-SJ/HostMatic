"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, Github, Globe2, LoaderCircle, Terminal, X } from "lucide-react";
import { io, Socket } from "socket.io-client";
import Link from "next/link";

type Status = "queued" | "cloning" | "building" | "publishing" | "deployed" | "failed";
type LogEntry = { message: string; timestamp: string };
type Deployment = { id: string; status: Status; url: string; repoUrl: string; logs?: LogEntry[]; error?: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:9002";

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [rootDirectory, setRootDirectory] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("dist");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const validUrl = useMemo(() => /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(repoUrl.trim()), [repoUrl]);
  const active = deployment && !["deployed", "failed"].includes(deployment.status);

  useEffect(() => {
    if (!deployment?.id) return;
    const id = deployment.id;
    const socket = io(SOCKET_URL, { reconnection: true });
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("subscribe", id));
    socket.on("status", (record: Deployment) => setDeployment((current) => current?.id === record.id ? { ...current, ...record } : current));
    socket.on("log", (entry: LogEntry) => setLogs((current) => current.some((item) => item.timestamp === entry.timestamp && item.message === entry.message) ? current : [...current, entry]));
    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/project/${id}`, { cache: "no-store" });
        if (!response.ok) return;
        const record = await response.json() as Deployment;
        setDeployment((current) => current?.id === id ? { ...current, ...record } : current);
        setLogs(record.logs || []);
      } catch { /* Socket.IO will continue when the API returns. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { window.clearInterval(timer); socket.disconnect(); socketRef.current = null; };
  }, [deployment?.id]);

  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [logs]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validUrl || submitting) return;
    setSubmitting(true); setError(""); setLogs([]); setDeployment(null);
    try {
      const response = await fetch(`${API_URL}/project`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), rootDirectory: rootDirectory.trim(), outputDirectory: outputDirectory.trim() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create deployment.");
      setDeployment(result as Deployment);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect to the API."); }
    finally { setSubmitting(false); }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_50%_-24%,#202630_0%,#0b0d11_52%,#090b0e_100%)]">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between border-b border-white/8 px-6">
        <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight" aria-label="HostMatic home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white text-black"><Globe2 size={21} strokeWidth={2.5} /></span>
          HostMatic
        </Link>
        <span className="hidden items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1.5 text-xs font-medium text-emerald-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Static deployment platform</span>
      </header>

      <section className="mx-auto flex max-w-3xl flex-col items-center px-5 pb-24 pt-20 sm:pt-28">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300"><span className="text-indigo-300">✦</span> From repository to live preview</div>
        <h1 className="max-w-2xl text-center text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-6xl">Deploy your next idea<span className="text-indigo-400">.</span></h1>
        <p className="mt-5 max-w-xl text-center text-base leading-7 text-slate-400 sm:text-lg">Paste a public GitHub repository. We’ll build your static site and give you a preview URL with live build logs.</p>

        <div className="mt-12 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#11141a] shadow-[0_30px_90px_rgba(0,0,0,.4)]">
          <div className="flex items-center gap-3 border-b border-white/8 px-6 py-5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300"><Github size={18} /></span><div><h2 className="text-sm font-semibold">New deployment</h2><p className="text-xs text-slate-500">Connect a public repository</p></div></div>
          <form onSubmit={submit} className="space-y-5 p-6">
            <div><label htmlFor="repo" className="mb-2 block text-sm font-medium text-slate-300">GitHub repository URL</label><div className="flex h-12 items-center gap-3 rounded-lg border border-white/12 bg-[#0b0d11] px-4 focus-within:border-indigo-400/70"><Github size={18} className="shrink-0 text-slate-500" /><input id="repo" type="url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/project" className="w-full bg-transparent text-sm text-white placeholder:text-slate-600" required /></div></div>
            <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-white" aria-expanded={advanced}><ChevronDown size={14} className={`transition ${advanced ? "rotate-180" : ""}`} /> Build settings</button>
            {advanced && <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="root" className="mb-2 block text-xs text-slate-400">Project directory</label><input id="root" value={rootDirectory} onChange={(event) => setRootDirectory(event.target.value)} placeholder=". (repository root)" className="h-11 w-full rounded-lg border border-white/12 bg-[#0b0d11] px-3 text-sm placeholder:text-slate-600" /></div><div><label htmlFor="output" className="mb-2 block text-xs text-slate-400">Output directory</label><input id="output" value={outputDirectory} onChange={(event) => setOutputDirectory(event.target.value)} placeholder="dist" className="h-11 w-full rounded-lg border border-white/12 bg-[#0b0d11] px-3 text-sm placeholder:text-slate-600" /></div></div>}
            <button type="submit" disabled={!validUrl || submitting || Boolean(active)} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-semibold text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">{submitting || active ? <><LoaderCircle size={16} className="animate-spin" /> Deploying</> : <>Deploy project <ArrowRight size={16} /></>}</button>
            {error && <p role="alert" className="flex items-center gap-2 text-sm text-rose-400"><X size={16} />{error}</p>}
          </form>
        </div>

        {deployment && <div className="mt-6 w-full space-y-5" aria-live="polite">
          <div className="flex flex-col gap-4 rounded-2xl border border-white/12 bg-[#11141a] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${deployment.status === "deployed" ? "bg-emerald-500/15 text-emerald-400" : deployment.status === "failed" ? "bg-rose-500/15 text-rose-400" : "bg-indigo-500/15 text-indigo-300"}`}>{deployment.status === "deployed" ? <Check size={18} /> : deployment.status === "failed" ? <X size={18} /> : <LoaderCircle size={18} className="animate-spin" />}</span><div><p className="text-sm font-semibold capitalize">{deployment.status}</p><p className="text-xs text-slate-500">Deployment {deployment.id}</p></div></div><a href={deployment.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 rounded-lg border border-white/12 bg-[#0b0d11] px-3 py-2 text-xs text-indigo-300 hover:border-indigo-400/50"><span className="truncate">{deployment.url}</span><ExternalLink size={13} className="shrink-0" /></a></div>
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0b0d11]"><div className="flex items-center gap-2 border-b border-white/10 bg-[#14181f] px-5 py-3 text-xs font-medium text-slate-300"><Terminal size={15} /> Build logs <span className="ml-auto text-slate-500">Live</span></div><div className="h-72 overflow-y-auto px-5 py-4 font-mono text-xs leading-6 text-emerald-300">{logs.length ? logs.map((entry, index) => <div key={`${entry.timestamp}-${index}`} className="break-all"><span className="select-none text-slate-600">$ </span>{entry.message}</div>) : <div className="text-slate-500">Waiting for build output…</div>}<div ref={logEnd} /></div></div>
        </div>}
        <div className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs text-slate-600"><span>Public GitHub repositories</span><span>npm build scripts</span><span>Static output</span></div>
      </section>
    </main>
  );
}
