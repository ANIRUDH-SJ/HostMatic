import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Check, ChevronDown, Copy, Github, Loader2, Terminal } from 'lucide-react'

type Status = 'queued' | 'cloning' | 'building' | 'publishing' | 'deployed' | 'failed'
type Deployment = { id: string; status: Status; url: string; logs: string[]; error?: string }
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

function isGithubRepository(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      url.pathname.split('/').filter(Boolean).length === 2 && !url.search && !url.hash
  } catch { return false }
}

async function readJson(response: Response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.')
  return data
}

export function Landing() {
  const [repoUrl, setRepoUrl] = useState('')
  const [rootDirectory, setRootDirectory] = useState('')
  const [outputDirectory, setOutputDirectory] = useState('dist')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [copied, setCopied] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next: Deployment = await readJson(await fetch(`${API_BASE}/api/status/${activeId}`, { cache: 'no-store' }))
        if (stopped) return
        setError('')
        setDeployment(next)
        if (next.status !== 'deployed' && next.status !== 'failed') timer = setTimeout(refresh, 1500)
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : 'Could not read deployment status.')
          timer = setTimeout(refresh, 3000)
        }
      }
    }
    timer = setTimeout(refresh, 500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [activeId])

  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'nearest' }) }, [deployment?.logs.length])

  async function deploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isGithubRepository(repoUrl)) {
      setError('Enter a public GitHub repository URL, such as https://github.com/owner/repo.')
      return
    }
    setError(''); setCopied(false); setSubmitting(true); setDeployment(null); setActiveId(null)
    try {
      const next: Deployment = await readJson(await fetch(`${API_BASE}/api/deploy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), rootDirectory: rootDirectory.trim(), outputDirectory: outputDirectory.trim() || 'dist' }),
      }))
      setDeployment({ ...next, logs: ['Deployment queued.'] })
      setActiveId(next.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deployment could not be started.')
    } finally { setSubmitting(false) }
  }

  const inProgress = deployment && !['deployed', 'failed'].includes(deployment.status)
  const statusText = deployment?.status === 'deployed' ? 'Ready' :
    deployment?.status === 'failed' ? 'Failed' : deployment?.status === 'queued' ? 'Queued' :
      deployment?.status === 'cloning' ? 'Cloning repository' :
        deployment?.status === 'building' ? 'Building project' : 'Publishing files'

  return <main className="page">
    <header className="site-header">
      <a className="brand" href="/" aria-label="HostMatic home"><span className="brand-mark" aria-hidden="true">H</span><span>HostMatic</span></a>
      <span className="header-tag">Deploy your next idea</span>
    </header>
    <div className="workspace">
      <div className="intro"><span className="eyebrow">FROM REPOSITORY TO LIVE SITE</span><h1>Deploy your GitHub repository.</h1><p>Paste a public repository URL. HostMatic will build it and give you a live preview.</p></div>
      <section className="deploy-panel" aria-label="New deployment">
        <form onSubmit={deploy}>
          <label className="field-label" htmlFor="repo-url">GitHub Repository URL</label>
          <div className="input-shell"><Github size={19} strokeWidth={1.9} aria-hidden="true" /><input id="repo-url" type="url" autoComplete="url" spellCheck={false} placeholder="https://github.com/username/repository" value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); setError('') }} required /></div>
          <details className="advanced"><summary><ChevronDown size={16} aria-hidden="true" /> Build settings</summary><div className="advanced-grid">
            <label htmlFor="root-directory">Project directory <span>optional</span></label><input id="root-directory" placeholder="frontend" value={rootDirectory} onChange={(event) => setRootDirectory(event.target.value)} />
            <label htmlFor="output-directory">Output directory</label><input id="output-directory" placeholder="dist" value={outputDirectory} onChange={(event) => setOutputDirectory(event.target.value)} />
          </div></details>
          {error && <p className="form-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{error}</p>}
          <button className="deploy-button" type="submit" disabled={submitting || Boolean(inProgress)}>{submitting || inProgress ? <Loader2 className="spinner" size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}{submitting ? 'Starting deployment...' : inProgress ? 'Deployment in progress' : deployment?.status === 'failed' ? 'Try again' : 'Deploy'}</button>
        </form>
      </section>
      {deployment && <section className="result" aria-label="Deployment status">
        <div className="result-heading"><div><span className="section-kicker">DEPLOYMENT</span><h2>Build activity <span className="deployment-id">#{deployment.id}</span></h2></div><span className={`status status-${deployment.status}`} role="status">{inProgress && <Loader2 className="spinner" size={14} aria-hidden="true" />}{deployment.status === 'deployed' && <Check size={14} aria-hidden="true" />}{deployment.status === 'failed' && <AlertCircle size={14} aria-hidden="true" />}{statusText}</span></div>
        <div className="preview-card"><span className="preview-label">PREVIEW URL</span>{deployment.status === 'deployed' ? <div className="preview-row"><a href={deployment.url} target="_blank" rel="noopener noreferrer">{deployment.url}<ArrowUpRight size={17} aria-hidden="true" /></a><button type="button" className="copy-button" aria-label="Copy preview URL" onClick={async () => { try { await navigator.clipboard.writeText(deployment.url); setCopied(true) } catch { setError('Could not copy the preview URL.') } }}>{copied ? <Check size={17} /> : <Copy size={17} />}</button></div> : <p>{deployment.status === 'failed' ? 'No preview was published.' : 'Your preview will appear here when the build finishes.'}</p>}</div>
        <div className="terminal"><div className="terminal-header"><Terminal size={15} aria-hidden="true" /><span>Build logs</span><span className="terminal-live">{inProgress ? 'LIVE' : 'COMPLETE'}</span></div><div className="terminal-body" role="log" aria-live="polite" aria-relevant="additions text">{deployment.logs.map((line, index) => <div className="log-line" key={`${index}-${line}`}><span className="log-prompt">&gt;</span><span>{line}</span></div>)}<div ref={logEndRef} /></div></div>
        {deployment.error && <p className="build-error" role="alert">{deployment.error}</p>}
      </section>}
    </div>
    <footer>Built for fast static deployments · HostMatic</footer>
  </main>
}
