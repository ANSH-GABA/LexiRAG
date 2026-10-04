import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type ButtonHTMLAttributes } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Route, Switch, Router as WouterRouter, Link, Redirect, useLocation } from 'wouter';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  ChevronDown, ChevronRight, Clock3, Columns2, FileCheck2, FileSearch2, FileText, Filter,
  FolderLock, Globe2, HeartPulse, LayoutDashboard, LoaderCircle, LockKeyhole,
  LogOut, Menu, MessageSquareText, Plus, Scale, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, TriangleAlert, Upload, X
} from 'lucide-react';
import {
  getGetDashboardQueryKey, getGetDocumentQueryKey, getHealthCheckQueryKey,
  getListDocumentsQueryKey, getListWorkspacesQueryKey, useAskDocuments, useCompareDocuments,
  useCreateDocument, useCreateWorkspace, useDeleteDocument, useExtractDocument, useGetDashboard,
  useGetDocument, useHealthCheck, useIndexDocument, useListDocuments,
  useListWorkspaces, useRequestUploadUrl
} from '@workspace/api-client-react';
import type { AskDocumentsOutput, CompareDocumentsOutput, Document, ExtractDocumentOutput } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#39766f', colorForeground: '#263746', colorMutedForeground: '#687579', colorDanger: '#a84038', colorBackground: '#fbfaf6', colorInput: '#f5f2e9', colorInputForeground: '#263746', colorNeutral: '#d9d3c7', fontFamily: 'DM Sans, sans-serif', borderRadius: '0.55rem' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf6] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#263746] font-semibold', headerSubtitle: 'text-[#687579]', socialButtonsBlockButtonText: 'text-[#263746] font-medium',
    formFieldLabel: 'text-[#263746] font-medium', footerActionLink: 'text-[#39766f] font-semibold', footerActionText: 'text-[#687579]',
    dividerText: 'text-[#687579]', formFieldInput: 'bg-[#f5f2e9] border-[#d9d3c7] text-[#263746]', formButtonPrimary: 'bg-[#39766f] hover:bg-[#2f655f]',
    socialButtonsBlockButton: 'border-[#d9d3c7] bg-[#fbfaf6]', alertText: 'text-[#263746]', main: 'text-[#263746]'
  }
};
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" data-testid="link-brand" className={`brand ${inverse ? 'brand-inverse' : ''}`}><img src={`${basePath}/logo.svg`} alt="" /><span>lexi<span>rag</span></span></Link>;
}
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`btn ${className}`} />;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-notice" role="alert"><TriangleAlert size={18} /><div><strong>That didn’t work</strong><p>{message}</p></div>{retry && <button onClick={retry} className="text-link" data-testid="button-retry">Try again</button>}</div>;
}
function Skeleton({ rows = 3 }: { rows?: number }) { return <div className="skeleton-stack" aria-label="Loading"><span className="skeleton sk-title" />{Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton sk-line" />)}</div>; }
function EmptyState({ icon: Icon = FolderLock, title, text, action }: { icon?: typeof FolderLock; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={23} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function exportText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
}
function citationLines(citations: AskDocumentsOutput['citations']) {
  return citations.map((c, i) => `[${i + 1}] ${c.documentName}, p. ${c.page} — ${c.excerpt} (relevance ${(c.score * 100).toFixed(0)}%)`).join('\n');
}
function timeLabel(value: string) {
  const date = new Date(value); if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function statusTone(status: string) { return status === 'ready' ? 'green' : status === 'failed' ? 'red' : status === 'indexing' ? 'gold' : 'neutral'; }
function StatusPill({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}><span className={`status-dot ${status}`} />{status}</Badge>;
}
function PageTitle({ eyebrow, title, subtitle, right }: { eyebrow: string; title: string; subtitle?: string; right?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1 className="serif">{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{right && <div className="title-actions">{right}</div>}</div>;
}

function Home() {
  const { isSignedIn, isLoaded } = useAuth();
  if (isLoaded && isSignedIn) return <Redirect to="/dashboard" />;
  return <main className="landing">
    <nav className="landing-nav"><Brand /><div className="landing-links"><a href="#method" data-testid="link-method">Method</a><a href="#privacy" data-testid="link-privacy">Privacy</a><Link href="/sign-in" data-testid="link-sign-in">Sign in <ArrowRight size={14} /></Link></div></nav>
    <section className="hero">
      <div className="hero-copy fade-up"><div className="eyebrow"><span className="live-mark" /> PRIVATE DOCUMENT INTELLIGENCE</div>
        <h1 className="serif">The record,<br /><em>in clear view.</em></h1>
        <p className="hero-description">A careful workspace for the documents that matter. Find the clause, trace the source, and move through complex records with confidence.</p>
        <div className="hero-actions"><Link href="/sign-up" className="btn btn-primary" data-testid="link-get-started">Open your workspace <ArrowRight size={16} /></Link><Link href="/sign-in" className="btn btn-quiet" data-testid="link-access-workspace">Sign in to continue</Link></div>
        <div className="trust-note"><LockKeyhole size={14} /> Private by design <span /> Answers tied to source pages</div>
      </div>
      <div className="hero-art" aria-label="Document evidence preview">
        <div className="art-grid" />
        <div className="paper-card paper-back"><div className="paper-meta">EXHIBIT 04 · 18 PAGES</div><div className="paper-line long" /><div className="paper-line" /><div className="paper-line short" /><div className="paper-line long" /><div className="paper-highlight">“The reporting party shall provide written notice within thirty (30) days...”</div><div className="paper-line" /><div className="paper-line long" /></div>
        <div className="evidence-callout"><span className="callout-pin">A</span><span>Notice period</span><span className="mono">p. 12</span></div>
        <div className="evidence-callout callout-b"><span className="callout-pin">B</span><span>Source passage located</span><Check size={13} /></div>
        <div className="art-index mono">01 / RECORD</div>
      </div>
      <div className="hero-bottom"><span>BUILT FOR PROFESSIONAL REVIEW</span><span>LEGAL · FINANCIAL · COMPLIANCE</span><span>VERIFIABLE SOURCES FIRST</span></div>
    </section>
    <section className="landing-band" id="method"><div className="band-number mono">01—</div><div><div className="eyebrow">A BETTER WAY THROUGH THE FILE</div><h2 className="serif">No black box.<br />No loose ends.</h2></div><p>LexiRAG keeps the answer and its evidence together. Ask in the language you work in, compare source documents side by side, and export findings with citations intact.</p></section>
    <section className="feature-grid">
      <article className="feature feature-large"><div className="feature-head"><MessageSquareText /><span className="mono">01 / ASK</span></div><h3 className="serif">Questions with<br />a paper trail.</h3><p>Explore your files in multiple languages. Every response points back to the page and passage it came from.</p><div className="mini-answer"><span className="mono">ANSWER · CONFIDENCE 91%</span><p>“The agreement requires notice within 30 days...”</p><span className="mini-source">Source · Framework Agreement, p. 12</span></div></article>
      <article className="feature"><div className="feature-head"><Columns2 /><span className="mono">02 / COMPARE</span></div><h3 className="serif">Differences,<br />made legible.</h3><p>Put two documents in view. Surface changes in dates, obligations, figures, and terms.</p></article>
      <article className="feature"><div className="feature-head"><FileSearch2 /><span className="mono">03 / EXTRACT</span></div><h3 className="serif">The details<br />that deserve a flag.</h3><p>Review clauses, deadlines, and financial figures with the original passage beside each finding.</p></article>
    </section>
    <section className="privacy-section" id="privacy"><div className="privacy-seal"><ShieldCheck size={35} strokeWidth={1.3} /></div><div><div className="eyebrow">YOUR RECORDS STAY YOURS</div><h2 className="serif">Private files.<br /><em>Traceable work.</em></h2></div><div className="privacy-copy"><p>Documents belong to a private workspace. Uploads move directly to secure storage; analysis is grounded in indexed source material, never presented as legal advice.</p><Link href="/sign-up" className="text-link">Create a private workspace <ArrowRight size={15} /></Link></div></section>
    <footer className="landing-footer"><Brand inverse /><span>Precision for the record.</span><span className="mono">LEXIRAG · PRIVATE DOCUMENT WORKSPACE</span></footer>
  </main>;
}

function AuthPage({ mode }: { mode: 'in' | 'up' }) {
  return <main className="auth-page"><div className="auth-aside"><Brand inverse /><div className="auth-editorial"><div className="eyebrow">THE EVIDENCE STAYS CLOSE</div><h1 className="serif">Careful review<br />starts here.</h1><p>One private place for the record, the question, and the source behind every answer.</p><div className="auth-caption mono">LEXIRAG / PRIVATE WORKSPACE</div></div></div><div className="auth-panel"><div className="auth-mobile-brand"><Brand /></div>{mode === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div></main>;
}

function ClerkInvalidator() {
  const { addListener } = useClerk(); const client = useQueryClient(); const prevUser = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => { const id = user?.id ?? null; if (prevUser.current !== undefined && prevUser.current !== id) client.clear(); prevUser.current = id; }), [addListener, client]);
  return null;
}

type PageChild = (workspaceId: string, workspaces: { id: string; name: string; documentCount: number }[]) => ReactNode;
function AppFrame({ children }: { children: ReactNode | PageChild }) {
  const { isLoaded, isSignedIn } = useAuth(); const { user } = useUser(); const { signOut } = useClerk(); const [location] = useLocation();
  const workspaces = useListWorkspaces({ query: { queryKey: getListWorkspacesQueryKey(), enabled: !!isSignedIn } });
  const createWorkspace = useCreateWorkspace(); const client = useQueryClient();
  const [activeId, setActiveId] = useState(''); const [workspaceDialog, setWorkspaceDialog] = useState(false); const [workspaceName, setWorkspaceName] = useState('');
  const workspaceList = workspaces.data ?? [];
  const workspaceId = activeId || workspaceList[0]?.id || '';
  useEffect(() => { if (workspaceList.length && !workspaceList.some(w => w.id === activeId)) setActiveId(workspaceList[0].id); }, [workspaceList, activeId]);
  if (!isLoaded) return <div className="auth-loading"><div className="skeleton sk-title" /><div className="skeleton sk-line" /></div>;
  if (!isSignedIn) return <Redirect to="/" />;
  const path = location.replace(basePath, '') || '/';
  const nav = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/documents', label: 'Documents', icon: FileText },
    { href: '/assistant', label: 'Ask your record', icon: MessageSquareText },
    { href: '/review', label: 'Compare & extract', icon: Scale }
  ];
  const submitWorkspace = (e: FormEvent) => {
    e.preventDefault(); if (!workspaceName.trim()) return;
    createWorkspace.mutate({ data: { name: workspaceName.trim() } }, { onSuccess: workspace => { setActiveId(workspace.id); client.invalidateQueries({ queryKey: getListWorkspacesQueryKey() }); setWorkspaceDialog(false); setWorkspaceName(''); } });
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-top"><Brand inverse /><span className="workspace-label">PRIVATE WORKSPACE</span>
        <label className="workspace-switch"><span className="workspace-monogram">{workspaceList[0]?.name?.slice(0, 1) || 'W'}</span><select aria-label="Choose workspace" value={workspaceId} onChange={e => setActiveId(e.target.value)} data-testid="select-workspace"><option value="">No workspace selected</option>{workspaceList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown size={14} /></label>
        {!workspaces.isLoading && <button className="sidebar-create" onClick={() => setWorkspaceDialog(true)} data-testid="button-create-workspace"><Plus size={14} /> New workspace</button>}
      </div>
      <div className="sidebar-nav-label">WORKSPACE</div><nav className="side-nav">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`nav-${href.slice(1)}`} className={`side-link ${path === href || (href === '/documents' && path.startsWith('/documents/')) ? 'active' : ''}`}><Icon size={17} /><span>{label}</span>{href === '/assistant' && <span className="nav-new">AI</span>}</Link>)}</nav>
      <div className="sidebar-spacer" /><div className="sidebar-footer"><div className="privacy-status"><span className="privacy-icon"><LockKeyhole size={14} /></span><div><strong>Private by default</strong><small>Only you can access this space</small></div></div><Link href="/settings" className={`side-link settings-link ${path === '/settings' ? 'active' : ''}`} data-testid="nav-settings"><Settings2 size={17} /><span>Settings</span></Link><div className="user-row"><span className="user-avatar">{(user?.firstName || user?.primaryEmailAddress?.emailAddress || 'U').slice(0, 1).toUpperCase()}</span><div className="user-info"><strong>{user?.fullName || 'Your account'}</strong><small>{user?.primaryEmailAddress?.emailAddress}</small></div><button className="icon-button signout" onClick={() => signOut({ redirectUrl: basePath || '/' })} aria-label="Sign out" data-testid="button-sign-out"><LogOut size={16} /></button></div></div>
    </aside>
    <div className="mobile-top"><button className="icon-button mobile-menu" onClick={() => document.querySelector('.sidebar')?.classList.toggle('mobile-open')} data-testid="button-menu" aria-label="Open navigation"><Menu size={19} /></button><Brand /><Link href="/settings" className="mobile-settings" data-testid="nav-mobile-settings"><Settings2 size={18} /></Link></div>
    <main className="main-content">{workspaces.isError && <ErrorNotice message="Workspace details could not be loaded." retry={() => workspaces.refetch()} />}{typeof children === 'function' ? (children as any)(workspaceId, workspaceList) : children}</main>
    {workspaceDialog && <div className="modal-backdrop" role="presentation" onClick={() => setWorkspaceDialog(false)}><form className="modal-card" onSubmit={submitWorkspace} onClick={e => e.stopPropagation()}><button type="button" className="modal-close" onClick={() => setWorkspaceDialog(false)} aria-label="Close" data-testid="button-close-workspace-dialog"><X size={18} /></button><span className="modal-icon"><FolderLock size={20} /></span><h2 className="serif">A private place for the record.</h2><p>Name a workspace to start organizing your documents.</p><input autoFocus maxLength={80} value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="e.g. Q4 acquisition review" data-testid="input-workspace-name" />{createWorkspace.isError && <p className="form-error" role="alert">Workspace creation failed. Please try again.</p>}<Button type="submit" className="btn-primary" disabled={!workspaceName.trim() || createWorkspace.isPending} data-testid="button-submit-workspace">{createWorkspace.isPending ? 'Creating…' : 'Create workspace'} <ArrowRight size={15} /></Button></form></div>}
  </div>;
}
function Protected({ children }: { children: PageChild }) { return <AppFrame>{children as any}</AppFrame>; }

function DashboardPage({ workspaceId }: { workspaceId: string }) {
  const dashboard = useGetDashboard({ workspaceId }, { query: { queryKey: getGetDashboardQueryKey({ workspaceId }), enabled: !!workspaceId } });
  if (!workspaceId) return <><PageTitle eyebrow="WORKSPACE OVERVIEW" title="A clear place to begin." subtitle="Create a private workspace to start reviewing your record." /><EmptyState title="No workspace yet" text="Your documents and analysis live in a private workspace." action={<Button className="btn-primary" onClick={() => document.querySelector<HTMLButtonElement>('[data-testid=button-create-workspace]')?.click()} data-testid="button-start-workspace"><Plus size={15} /> Create workspace</Button>} /></>;
  if (dashboard.isLoading) return <><PageTitle eyebrow="WORKSPACE OVERVIEW" title="Your record, at a glance." /><Skeleton rows={6} /></>;
  if (dashboard.isError || !dashboard.data) return <><PageTitle eyebrow="WORKSPACE OVERVIEW" title="Your record, at a glance." /><ErrorNotice message="The overview could not be retrieved." retry={() => dashboard.refetch()} /></>;
  const d = dashboard.data; const metrics = [{ name: 'Documents', value: d.metrics.documentCount, note: 'in this workspace', icon: FileText }, { name: 'Ready to review', value: d.metrics.readyCount, note: `${d.metrics.indexingCount} indexing`, icon: FileCheck2 }, { name: 'Upcoming deadlines', value: d.metrics.deadlineCount, note: 'identified in records', icon: Clock3 }, { name: 'Review activity', value: d.metrics.reviewCount, note: 'comparisons & analysis', icon: Activity }];
  return <div className="fade-up"><PageTitle eyebrow="WORKSPACE OVERVIEW" title="Your record, at a glance." subtitle={`${d.workspace.name} · Updated as your documents are indexed`} right={<Link href="/documents" className="btn btn-primary" data-testid="link-upload-document"><Upload size={15} /> Add documents</Link>} />
    <section className="metric-grid">{metrics.map(({ name, value, note, icon: Icon }, i) => <article className={`metric-card metric-${i}`} key={name} data-testid={`metric-${name.toLowerCase().replaceAll(' ', '-')}`}><div className="metric-label">{name}<Icon size={17} /></div><div className="metric-value mono">{value}</div><div className="metric-note">{note}</div></article>)}</section>
    <div className="dashboard-columns"><section className="panel recent-panel"><div className="panel-heading"><div><div className="eyebrow">LATEST IN THE RECORD</div><h2 className="serif">Recent documents</h2></div><Link href="/documents" className="text-link" data-testid="link-all-documents">All documents <ArrowRight size={14} /></Link></div>
      {d.recentDocuments.length ? <div className="document-list">{d.recentDocuments.map(doc => <DocumentRow key={doc.id} doc={doc} />)}</div> : <EmptyState icon={FileText} title="The record is ready for its first file." text="Upload a PDF to begin a searchable, cited workspace." action={<Link href="/documents" className="text-link" data-testid="link-empty-upload">Upload a document <ArrowRight size={14} /></Link>} />}
    </section><div className="dashboard-side"><section className="panel deadline-panel"><div className="panel-heading"><div><div className="eyebrow">FROM YOUR DOCUMENTS</div><h2 className="serif">Upcoming deadlines</h2></div><Clock3 size={17} /></div>{d.upcomingDeadlines.length ? <div className="deadline-list">{d.upcomingDeadlines.map((item, i) => <Link key={`${item.documentId}-${i}`} href={`/documents/${item.documentId}`} className="deadline-item" data-testid={`deadline-${item.documentId}-${i}`}><span className={`risk-edge risk-${item.riskLevel}`} /><div><div className="deadline-date mono">{timeLabel(item.date)} <Badge tone={item.riskLevel === 'high' ? 'red' : item.riskLevel === 'medium' ? 'gold' : 'green'}>{item.riskLevel} risk</Badge></div><strong>{item.description}</strong><small>{item.documentName}</small></div><ChevronRight size={15} /></Link>)}</div> : <div className="mini-empty"><Clock3 size={17} /><span>No deadlines surfaced yet.</span></div>}</section>
      <section className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">WORKSPACE LOG</div><h2 className="serif">Recent activity</h2></div><Activity size={17} /></div>{d.recentActivity.length ? <div className="activity-list">{d.recentActivity.map(a => <div className="activity-row" key={a.id} data-testid={`activity-${a.id}`}><span className="activity-dot" /><div><strong>{a.title}</strong><small>{a.type} · {timeLabel(a.createdAt)}</small></div></div>)}</div> : <div className="mini-empty"><Activity size={17} /><span>Activity will appear as you work.</span></div>}</section></div></div>
  </div>;
}
function DocumentRow({ doc, onDelete }: { doc: Document; onDelete?: (doc: Document) => void }) {
  return <div className="doc-row" data-testid={`document-row-${doc.id}`}><Link href={`/documents/${doc.id}`} className="doc-file-icon" data-testid={`link-document-${doc.id}`}><FileText size={19} /></Link><Link href={`/documents/${doc.id}`} className="doc-name-block"><strong>{doc.name}</strong><small>{fmtSize(doc.size)} <span>·</span> {doc.pageCount ?? '—'} pages <span>·</span> {timeLabel(doc.uploadedAt)}</small></Link><div className="doc-row-status"><StatusPill status={doc.status} />{doc.language && <span className="language-tag">{doc.language}</span>}</div>{onDelete && <button className="icon-button delete-doc" onClick={() => onDelete(doc)} aria-label={`Delete ${doc.name}`} data-testid={`button-delete-${doc.id}`}><Trash2 size={16} /></button>}</div>;
}

function DocumentsPage({ workspaceId }: { workspaceId: string }) {
  const docs = useListDocuments({ workspaceId }, { query: { queryKey: getListDocumentsQueryKey({ workspaceId }), enabled: !!workspaceId } });
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [pendingDelete, setPendingDelete] = useState<Document | null>(null);
  const [uploading, setUploading] = useState(false); const [uploadError, setUploadError] = useState(''); const fileRef = useRef<HTMLInputElement>(null);
  const requestUrl = useRequestUploadUrl(); const createDoc = useCreateDocument(); const indexDoc = useIndexDocument(); const del = useDeleteDocument(); const client = useQueryClient();
  const filtered = useMemo(() => (docs.data ?? []).filter(d => d.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || d.status === filter)), [docs.data, query, filter]);
  async function uploadFile(file?: File) {
    if (!file || !workspaceId) return; setUploadError('');
    if (file.type !== 'application/pdf' || file.size > 50 * 1024 * 1024) { setUploadError('Choose a PDF under 50 MB.'); return; }
    setUploading(true);
    try {
      const signed = await requestUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: 'application/pdf' } });
      const response = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      if (!response.ok) throw new Error('Secure upload did not complete. Please retry.');
      const document = await createDoc.mutateAsync({ data: { workspaceId, name: file.name, mimeType: 'application/pdf', size: file.size, objectPath: signed.objectPath } });
      await client.invalidateQueries({ queryKey: getListDocumentsQueryKey({ workspaceId }) });
      indexDoc.mutate({ documentId: document.id }, { onSettled: () => { client.invalidateQueries({ queryKey: getListDocumentsQueryKey({ workspaceId }) }); client.invalidateQueries({ queryKey: getGetDocumentQueryKey(document.id) }); } });
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'The file could not be uploaded.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function confirmDelete() { if (!pendingDelete) return; del.mutate({ documentId: pendingDelete.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListDocumentsQueryKey({ workspaceId }) }); setPendingDelete(null); }, onError: () => setUploadError('The document could not be deleted. Try again.') }); }
  if (!workspaceId) return <><PageTitle eyebrow="DOCUMENT LIBRARY" title="The record." /><EmptyState title="Create a workspace first" text="Your private document library is held in a workspace." /></>;
  return <div className="fade-up"><PageTitle eyebrow="DOCUMENT LIBRARY" title="The record." subtitle="Private PDFs, indexed with their source pages close at hand." right={<><input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => uploadFile(e.target.files?.[0])} data-testid="input-pdf-file" /><Button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-upload-pdf">{uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{uploading ? 'Uploading securely…' : 'Upload PDF'}</Button></>} />
    <div className="upload-info"><LockKeyhole size={15} /><span>Private uploads · PDF only · Up to 50 MB</span><span className="upload-info-sep">Your file is stored securely before indexing.</span></div>
    {uploadError && <ErrorNotice message={uploadError} retry={() => setUploadError('')} />}
    {uploading && <div className="processing-card"><span className="processing-icon"><LoaderCircle size={17} className="spin" /></span><div><strong>Uploading to private storage</strong><small>Indexing will begin once the upload completes.</small></div><div className="progress-track"><i /></div></div>}
    <div className="library-controls"><label className="search-box"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents" data-testid="input-search-documents" />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><label className="filter-select"><Filter size={15} /><select value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-document-status"><option value="all">All statuses</option><option value="ready">Ready</option><option value="indexing">Indexing</option><option value="uploaded">Uploaded</option><option value="failed">Failed</option></select><ChevronDown size={13} /></label><span className="result-count mono">{docs.data?.length ?? 0} FILES</span></div>
    <section className="library-table">{docs.isLoading ? <Skeleton rows={5} /> : docs.isError ? <ErrorNotice message="Documents could not be loaded." retry={() => docs.refetch()} /> : filtered.length ? <>{filtered.map(doc => <DocumentRow key={doc.id} doc={doc} onDelete={setPendingDelete} />)}</> : <EmptyState icon={query || filter !== 'all' ? Search : FileText} title={query || filter !== 'all' ? 'No matching documents' : 'No documents in this workspace'} text={query || filter !== 'all' ? 'Try another search or status filter.' : 'Upload a private PDF to make it searchable and ready for cited review.'} action={query || filter !== 'all' ? <button className="text-link" onClick={() => { setQuery(''); setFilter('all'); }} data-testid="button-clear-filters">Clear filters</button> : <Button className="btn-primary" onClick={() => fileRef.current?.click()} data-testid="button-empty-upload"><Upload size={14} /> Upload first PDF</Button>} />}</section>
    <div className="library-foot"><span className="mono">INDEXING STATUS</span><span><i className="legend-dot ready" /> Ready</span><span><i className="legend-dot indexing" /> In progress</span><span><i className="legend-dot failed" /> Needs attention</span></div>
    {pendingDelete && <div className="modal-backdrop" role="presentation" onClick={() => setPendingDelete(null)}><div className="modal-card delete-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setPendingDelete(null)} aria-label="Close"><X size={18} /></button><span className="modal-icon warning"><Trash2 size={19} /></span><h2 className="serif">Remove this document?</h2><p><strong>{pendingDelete.name}</strong> and its indexed content will be removed from this workspace. This cannot be undone.</p><div className="modal-actions"><Button className="btn-quiet" onClick={() => setPendingDelete(null)} data-testid="button-cancel-delete">Keep document</Button><Button className="btn-danger" onClick={confirmDelete} disabled={del.isPending} data-testid="button-confirm-delete">{del.isPending ? 'Removing…' : 'Remove document'}</Button></div></div></div>}
  </div>;
}

function DocumentPage({ documentId }: { documentId: string }) {
  const docQuery = useGetDocument(documentId, { query: { queryKey: getGetDocumentQueryKey(documentId), enabled: !!documentId } });
  const document = docQuery.data;
  const index = useIndexDocument(); const [showDelete, setShowDelete] = useState(false); const del = useDeleteDocument(); const client = useQueryClient(); const [, setLocation] = useLocation();
  if (docQuery.isLoading) return <><div className="back-link"><ArrowLeft size={15} /> Documents</div><Skeleton rows={7} /></>;
  if (docQuery.isError || !document) return <><Link href="/documents" className="back-link"><ArrowLeft size={15} /> Documents</Link><ErrorNotice message="This document could not be found or accessed." retry={() => docQuery.refetch()} /></>;
  const runIndex = () => index.mutate({ documentId }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetDocumentQueryKey(documentId) }); }, onError: () => client.invalidateQueries({ queryKey: getGetDocumentQueryKey(documentId) }) });
  return <div className="fade-up"><Link href="/documents" className="back-link" data-testid="link-back-documents"><ArrowLeft size={15} /> Document library</Link><PageTitle eyebrow="DOCUMENT RECORD" title={document.name} subtitle={`${fmtSize(document.size)} · Uploaded ${timeLabel(document.uploadedAt)}`} right={<><StatusPill status={document.status} /><button className="icon-button" onClick={() => setShowDelete(true)} aria-label="Delete document" data-testid="button-delete-document"><Trash2 size={17} /></button></>} />
    {document.status === 'failed' && <ErrorNotice message={document.error || 'Indexing could not complete. You can retry the extraction.'} retry={runIndex} />}
    {document.status !== 'ready' && document.status !== 'failed' && <div className="processing-card"><span className="processing-icon"><LoaderCircle className={document.status === 'indexing' ? 'spin' : ''} size={17} /></span><div><strong>{document.status === 'indexing' ? 'Indexing document' : 'Document uploaded'}</strong><small>{document.status === 'indexing' ? 'Text and page references are being prepared.' : 'Start indexing to make this file available for search and review.'}</small></div>{document.status === 'uploaded' && <Button className="btn-primary" onClick={runIndex} disabled={index.isPending} data-testid="button-index-document">{index.isPending ? 'Starting…' : 'Index document'}</Button>}</div>}
    <div className="detail-meta-grid"><div><span>PAGE COUNT</span><strong>{document.pageCount ?? 'Not indexed'}</strong></div><div><span>TEXT SEGMENTS</span><strong>{document.chunkCount}</strong></div><div><span>LANGUAGE</span><strong>{document.language || 'Detected after indexing'}</strong></div><div><span>LAST UPDATED</span><strong>{timeLabel(document.updatedAt)}</strong></div></div>
    <section className="preview-panel"><div className="preview-heading"><div><div className="eyebrow">SECURE PREVIEW</div><h2 className="serif">Source document</h2></div><a href={`/api/storage${document.objectPath}`} target="_blank" rel="noreferrer" className="text-link" data-testid="link-open-pdf">Open in new tab <ArrowUpRight size={14} /></a></div>
      <iframe className="pdf-frame" src={`/api/storage${document.objectPath}`} title={`Secure preview of ${document.name}`} data-testid="frame-document-preview" />
    </section>
    {showDelete && <div className="modal-backdrop"><div className="modal-card delete-modal" role="dialog" aria-modal="true"><span className="modal-icon warning"><Trash2 size={19} /></span><h2 className="serif">Remove this document?</h2><p><strong>{document.name}</strong> and its indexed content will be permanently removed.</p><div className="modal-actions"><Button className="btn-quiet" onClick={() => setShowDelete(false)} data-testid="button-cancel-detail-delete">Cancel</Button><Button className="btn-danger" disabled={del.isPending} onClick={() => del.mutate({ documentId }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListDocumentsQueryKey({ workspaceId: document.workspaceId }) }); setLocation('/documents'); } })} data-testid="button-confirm-detail-delete">{del.isPending ? 'Removing…' : 'Remove document'}</Button></div></div></div>}
  </div>;
}

function Citations({ items }: { items: AskDocumentsOutput['citations'] }) {
  if (!items.length) return <div className="no-citations">No source passages were returned.</div>;
  return <div className="citations-block"><div className="citation-label"><BookOpen size={14} /> SOURCE PASSAGES <span className="mono">{items.length}</span></div>{items.map((citation, i) => <Link key={`${citation.documentId}-${citation.page}-${i}`} href={`/documents/${citation.documentId}`} className="citation-item" data-testid={`citation-${citation.documentId}-${citation.page}-${i}`}><span className="citation-number mono">[{i + 1}]</span><div><strong>{citation.documentName}<span className="citation-page">p. {citation.page}</span></strong><p>“{citation.excerpt}”</p><small>Match {(citation.score * 100).toFixed(0)}%</small></div><ArrowUpRight size={13} /></Link>)}</div>;
}
function AssistantPage({ workspaceId }: { workspaceId: string }) {
  const documents = useListDocuments({ workspaceId }, { query: { queryKey: getListDocumentsQueryKey({ workspaceId }), enabled: !!workspaceId } });
  const readyDocs = (documents.data ?? []).filter(d => d.status === 'ready');
  const ask = useAskDocuments(); const [question, setQuestion] = useState(''); const [results, setResults] = useState<{ question: string; result: AskDocumentsOutput }[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  async function submit(e: FormEvent) { e.preventDefault(); if (!workspaceId || !question.trim()) return; try { const q = question.trim(); const answer = await ask.mutateAsync({ data: { workspaceId, question: q, ...(selected.length ? { documentIds: selected } : {}), history: results.slice(-8).flatMap(x => [{ role: 'user' as const, content: x.question }, { role: 'assistant' as const, content: x.result.answer }]) } }); setResults(prev => [...prev, { question: q, result: answer }]); setQuestion(''); } catch { /* mutation error rendered below */ } }
  function exportAnswer(result: AskDocumentsOutput, q: string) { exportText('lexirag-cited-answer.txt', `LEXIRAG — CITED ANSWER\n\nQuestion\n${q}\n\nAnswer\n${result.answer}\n\nConfidence: ${(result.confidence * 100).toFixed(0)}%\n\nSources\n${citationLines(result.citations)}\n\n${result.notice}\n\nThis AI-generated output is for document review only and is not legal advice.`); }
  if (!workspaceId) return <><PageTitle eyebrow="EVIDENCE-GROUNDED Q&A" title="Ask the record." /><EmptyState title="Create a workspace first" text="Questions are answered only from the indexed documents in your private workspace." /></>;
  return <div className="fade-up"><PageTitle eyebrow="EVIDENCE-GROUNDED Q&A" title="Ask the record." subtitle="Ask in your working language. Every response stays attached to its source." right={<span className="privacy-chip"><LockKeyhole size={13} /> Private session</span>} />
    <div className="assistant-layout"><section className="assistant-main"><div className="assistant-scope"><Globe2 size={16} /><span>Multilingual review</span><i /><span>{readyDocs.length} indexed {readyDocs.length === 1 ? 'document' : 'documents'}</span></div>
      {documents.isLoading ? <Skeleton rows={4} /> : documents.isError ? <ErrorNotice message="The document set could not be loaded." retry={() => documents.refetch()} /> : !readyDocs.length ? <EmptyState icon={MessageSquareText} title="Index a document to begin." text="Only successfully indexed records can ground an answer. Upload a PDF and wait for its status to show ready." action={<Link href="/documents" className="text-link" data-testid="link-assistant-library">Open document library <ArrowRight size={14} /></Link>} /> : results.length ? <div className="conversation">{results.map((entry, i) => <article className="answer-turn" key={`${i}-${entry.question}`} data-testid={`answer-turn-${i}`}><div className="question-turn"><span className="question-avatar">YOU</span><p>{entry.question}</p></div><div className="answer-card"><div className="answer-header"><span className="answer-mark"><Sparkles size={14} /></span><strong>Evidence review</strong><Badge tone="green">{(entry.result.confidence * 100).toFixed(0)}% confidence</Badge><button className="icon-button export-icon" onClick={() => exportAnswer(entry.result, entry.question)} aria-label="Export cited answer" data-testid={`button-export-answer-${i}`}><ArrowDownToLine size={15} /></button></div><p className="answer-text">{entry.result.answer}</p><Citations items={entry.result.citations} /><div className="notice-line"><TriangleAlert size={13} />{entry.result.notice || 'AI-generated document review is not legal advice.'}</div><div className="answer-export-row"><button className="text-link" onClick={() => exportAnswer(entry.result, entry.question)} data-testid={`button-download-answer-${i}`}><ArrowDownToLine size={14} /> Export cited answer</button><span className="mono">AI OUTPUT · NOT LEGAL ADVICE</span></div></div></article>)}</div> : <div className="assistant-welcome"><span className="welcome-symbol"><MessageSquareText size={21} /></span><div className="eyebrow">A QUESTION, WITH ITS SOURCES</div><h2 className="serif">What does the record say?</h2><p>Ask about obligations, dates, parties, figures, or differences across your indexed files.</p><div className="prompt-chips">{['What deadlines are stated?', 'Summarize the termination terms', 'Find the largest payment obligation'].map((s, i) => <button key={s} onClick={() => setQuestion(s)} data-testid={`button-prompt-${i}`}>{s}<ArrowUpRight size={13} /></button>)}</div></div>}
      {ask.isError && <ErrorNotice message="The answer could not be grounded in your documents. Try a narrower question or another source." retry={() => ask.reset()} />}
      {readyDocs.length > 0 && <form className="question-form" onSubmit={submit}><textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask a question about the evidence…" rows={2} maxLength={4000} data-testid="input-question" /><div className="question-tools"><span className="mono">{question.length}/4000 · ANSWERS INCLUDE SOURCE PAGES</span><Button type="submit" className="btn-primary" disabled={!question.trim() || ask.isPending} data-testid="button-ask-question">{ask.isPending ? <><LoaderCircle className="spin" size={15} /> Reviewing…</> : <>Ask the record <ArrowRight size={15} /></>}</Button></div></form>}
    </section><aside className="assistant-sources"><div className="sources-head"><div className="eyebrow">SCOPE YOUR REVIEW</div><h3 className="serif">Source set</h3><p>Leave clear for all indexed files, or select specific documents.</p></div><button className={`source-option ${selected.length === 0 ? 'selected' : ''}`} onClick={() => setSelected([])} data-testid="button-all-sources"><span className="source-check">{selected.length === 0 && <Check size={12} />}</span><div><strong>All indexed documents</strong><small>{readyDocs.length} available sources</small></div></button>{readyDocs.map(doc => <button key={doc.id} className={`source-option ${selected.includes(doc.id) ? 'selected' : ''}`} onClick={() => toggle(doc.id)} data-testid={`button-source-${doc.id}`}><span className="source-check">{selected.includes(doc.id) && <Check size={12} />}</span><FileText size={15} /><div><strong>{doc.name}</strong><small>{doc.pageCount ?? '—'} pages</small></div></button>)}<div className="source-safety"><ShieldCheck size={15} /><span>Answers are generated from selected source material. Verify important findings against the original document.</span></div></aside></div>
  </div>;
}

function ReviewPage({ workspaceId }: { workspaceId: string }) {
  const docs = useListDocuments({ workspaceId }, { query: { queryKey: getListDocumentsQueryKey({ workspaceId }), enabled: !!workspaceId } });
  const ready = (docs.data ?? []).filter(d => d.status === 'ready'); const [a, setA] = useState(''); const [b, setB] = useState(''); const [criterion, setCriterion] = useState(''); const [comparison, setComparison] = useState<CompareDocumentsOutput | null>(null); const [extractResult, setExtractResult] = useState<ExtractDocumentOutput | null>(null);
  const compare = useCompareDocuments(); const extract = useExtractDocument();
  async function runCompare(e: FormEvent) { e.preventDefault(); if (!workspaceId || !a || !b || a === b || !criterion.trim()) return; try { setComparison(await compare.mutateAsync({ data: { workspaceId, documentAId: a, documentBId: b, criterion: criterion.trim() } })); } catch { setComparison(null); } }
  async function runExtract(kind: 'clauses' | 'deadlines' | 'financial') { if (!workspaceId || !a) return; setExtractResult(null); try { setExtractResult(await extract.mutateAsync({ data: { workspaceId, documentId: a, analysisType: kind } })); } catch { setExtractResult(null); } }
  const docA = ready.find(d => d.id === a); const docB = ready.find(d => d.id === b);
  function exportComparison() {
    if (!comparison) return;
    const details = comparison.rows.map((r, i) => `${i + 1}. ${r.aspect}\n${docA?.name ?? 'Document A'}: ${r.documentA}\n${docB?.name ?? 'Document B'}: ${r.documentB}\nDifference: ${r.difference}\nSources A: ${r.citationsA.map(c => `${c.documentName}, p. ${c.page}: ${c.excerpt}`).join('; ')}\nSources B: ${r.citationsB.map(c => `${c.documentName}, p. ${c.page}: ${c.excerpt}`).join('; ')}`).join('\n\n');
    exportText('lexirag-document-comparison.txt', `LEXIRAG — CITED DOCUMENT COMPARISON\n\n${comparison.summary}\n\n${details}\n\nAI-generated analysis is for document review only and is not legal advice.`);
  }
  function exportExtraction() { if (!extractResult) return; const text = extractResult.items.map((item, i) => `${i + 1}. ${item.label}: ${item.value}\nRisk: ${item.riskLevel || 'not assessed'}\nSource: ${item.citation.documentName}, p. ${item.citation.page} — ${item.citation.excerpt}`).join('\n\n'); exportText(`lexirag-${extractResult.analysisType}-findings.txt`, `LEXIRAG — ${extractResult.analysisType.toUpperCase()} REVIEW\n\n${extractResult.summary}\n\n${text}\n\nAI-generated analysis is for document review only and is not legal advice.`); }
  if (!workspaceId) return <><PageTitle eyebrow="DOCUMENT REVIEW" title="Compare and extract." /><EmptyState title="Create a workspace first" text="Comparisons and extraction run only against files in your private workspace." /></>;
  return <div className="fade-up"><PageTitle eyebrow="DOCUMENT REVIEW" title="Compare and extract." subtitle="Put source documents in conversation. Findings stay linked to the record." right={<span className="review-stamp"><Scale size={14} /> SOURCE-REFERENCED</span>} />
    {docs.isError && <ErrorNotice message="Documents could not be loaded." retry={() => docs.refetch()} />}
    {docs.isLoading ? <Skeleton rows={4} /> : ready.length < 1 ? <EmptyState icon={Columns2} title="Index a document to begin." text="Comparison and clause extraction are available for indexed PDFs." action={<Link href="/documents" className="text-link" data-testid="link-review-documents">Open document library <ArrowRight size={14} /></Link>} /> : <div className="review-layout">
      <section className="review-setup panel"><div className="eyebrow">01 / SIDE-BY-SIDE REVIEW</div><h2 className="serif">Compare documents</h2><p className="section-intro">Choose two indexed sources and name the point you want to review.</p>
        <form onSubmit={runCompare}><label className="field-label">DOCUMENT A<select value={a} onChange={e => setA(e.target.value)} data-testid="select-document-a"><option value="">Choose a document</option>{ready.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><div className="swap-divider"><span /><Columns2 size={17} /><span /></div><label className="field-label">DOCUMENT B<select value={b} onChange={e => setB(e.target.value)} data-testid="select-document-b"><option value="">Choose a document</option>{ready.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label className="field-label">REVIEW FOCUS<input value={criterion} onChange={e => setCriterion(e.target.value)} placeholder="e.g. payment terms, notice period" maxLength={240} data-testid="input-comparison-criterion" /></label><Button className="btn-primary full-button" disabled={!a || !b || a === b || !criterion.trim() || compare.isPending} data-testid="button-compare-documents">{compare.isPending ? <><LoaderCircle className="spin" size={15} /> Comparing source passages…</> : <>Compare records <ArrowRight size={15} /></>}</Button></form>
        {a && <div className="extract-tools"><div className="eyebrow">02 / EXTRACT FROM DOCUMENT A</div><p>Identify relevant details with cited passages.</p><div className="extract-buttons">{(['clauses', 'deadlines', 'financial'] as const).map(kind => <button key={kind} disabled={extract.isPending} onClick={() => runExtract(kind)} data-testid={`button-extract-${kind}`}><FileSearch2 size={15} /><span>{kind === 'financial' ? 'Financial figures' : kind[0].toUpperCase() + kind.slice(1)}</span><ArrowRight size={13} /></button>)}</div></div>}
        {compare.isError && <ErrorNotice message="The comparison could not be completed. Confirm both documents are indexed and try again." retry={() => compare.reset()} />}
        {extract.isError && <ErrorNotice message="Extraction could not be completed. Try another indexed source." retry={() => extract.reset()} />}
      </section>
      <section className="review-results">{comparison ? <div className="panel result-panel"><div className="results-heading"><div><div className="eyebrow">COMPARISON FINDINGS</div><h2 className="serif">{docA?.name} <span>↔</span> {docB?.name}</h2></div><Button className="btn-outline" onClick={exportComparison} data-testid="button-export-comparison"><ArrowDownToLine size={14} /> Export cited report</Button></div><p className="result-summary">{comparison.summary}</p>{comparison.rows.length ? <div className="comparison-table"><div className="comparison-colheads"><span>ASPECT</span><span>{docA?.name}</span><span>{docB?.name}</span></div>{comparison.rows.map((row, i) => <article className="comparison-row" key={`${row.aspect}-${i}`} data-testid={`comparison-row-${i}`}><strong>{row.aspect}</strong><div>{row.documentA}<CitationMini citations={row.citationsA} /></div><div>{row.documentB}<CitationMini citations={row.citationsB} /></div><p className="difference"><span>DIFFERENCE</span>{row.difference}</p></article>)}</div> : <EmptyState title="No distinct aspects returned" text="Try a more specific comparison focus." />}<div className="notice-line"><TriangleAlert size={13} />AI-generated analysis for document review only; not legal advice.</div></div> : <div className="review-placeholder"><span className="placeholder-glyph"><Columns2 size={24} /></span><div className="eyebrow">YOUR ANALYSIS, WITH EVIDENCE</div><h2 className="serif">The differences are in the details.</h2><p>Choose a pair of indexed documents to see cited changes, or extract dates, clauses, and financial figures from one source.</p><div className="placeholder-rule" /><span className="mono">COMPARISON · CLAUSES · DEADLINES · FIGURES</span></div>}
        {extractResult && <div className="panel extraction-panel"><div className="results-heading"><div><div className="eyebrow">EXTRACTED {extractResult.analysisType.toUpperCase()}</div><h2 className="serif">{docA?.name}</h2></div><Button className="btn-outline" onClick={exportExtraction} data-testid="button-export-extraction"><ArrowDownToLine size={14} /> Export cited findings</Button></div><p className="result-summary">{extractResult.summary}</p>{extractResult.items.length ? <div className="extraction-list">{extractResult.items.map((item, i) => <article key={`${item.label}-${i}`} className="extraction-item" data-testid={`extracted-item-${i}`}><div className="extraction-item-head"><strong>{item.label}</strong>{item.riskLevel && <Badge tone={item.riskLevel === 'high' ? 'red' : item.riskLevel === 'medium' ? 'gold' : 'green'}>{item.riskLevel} risk</Badge>}</div><p>{item.value}</p><Link href={`/documents/${item.citation.documentId}`} className="extraction-source" data-testid={`link-extraction-source-${i}`}><BookOpen size={13} />{item.citation.documentName} · p. {item.citation.page}<span>“{item.citation.excerpt}”</span></Link></article>)}</div> : <EmptyState title="No findings returned" text="There were no matching findings for this source." />}<div className="notice-line"><TriangleAlert size={13} />AI-generated analysis for document review only; not legal advice.</div></div>}
      </section></div>}
  </div>;
}
function CitationMini({ citations }: { citations: AskDocumentsOutput['citations'] }) { return citations.length ? <div className="mini-citations">{citations.map((c, i) => <Link key={`${c.documentId}-${c.page}-${i}`} href={`/documents/${c.documentId}`} data-testid={`link-mini-citation-${c.documentId}-${c.page}`}>{c.documentName} · p. {c.page}</Link>)}</div> : <small className="no-citations-inline">No citation returned</small>; }

function SettingsPage() {
  const { user } = useUser(); const { signOut } = useClerk(); const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 } });
  return <div className="fade-up"><PageTitle eyebrow="ACCOUNT & SERVICE" title="Settings." subtitle="Your identity, privacy, and service health." />
    <div className="settings-grid"><section className="panel settings-card"><div className="settings-card-head"><span className="settings-symbol"><Settings2 size={19} /></span><div><div className="eyebrow">SIGNED-IN PROFILE</div><h2 className="serif">Your account</h2></div></div><div className="profile-block"><span className="profile-avatar">{(user?.firstName || user?.primaryEmailAddress?.emailAddress || 'U').slice(0, 1).toUpperCase()}</span><div><strong data-testid="text-profile-name">{user?.fullName || 'Workspace member'}</strong><small data-testid="text-profile-email">{user?.primaryEmailAddress?.emailAddress || 'Email not available'}</small></div></div><div className="settings-row"><span>Authentication</span><strong>Secure session</strong></div><div className="settings-row"><span>Workspace access</span><strong>Private to your account</strong></div><Button className="btn-outline signout-button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-settings-sign-out"><LogOut size={15} /> Sign out</Button></section>
      <section className="panel settings-card"><div className="settings-card-head"><span className="settings-symbol service"><HeartPulse size={19} /></span><div><div className="eyebrow">SERVICE STATUS</div><h2 className="serif">System health</h2></div></div>{health.isLoading ? <div className="health-loading"><span className="skeleton sk-line" /><span className="skeleton sk-line" /></div> : health.isError ? <div className="health-status error"><span className="health-indicator" /><div><strong>Service status unavailable</strong><small>We couldn’t reach the health endpoint.</small></div><button className="icon-button" onClick={() => health.refetch()} aria-label="Retry health check" data-testid="button-retry-health"><Activity size={16} /></button></div> : <div className="health-status"><span className="health-indicator" /><div><strong data-testid="status-service-health">{health.data?.status || 'Service responding'}</strong><small>Health check · refreshed every minute</small></div><Badge tone="green">Connected</Badge></div>}<div className="service-foot"><ShieldCheck size={15} /><span>Documents are stored privately. Service status does not expose document contents.</span></div></section></div>
    <section className="settings-note"><LockKeyhole size={15} /><p>LexiRAG helps you navigate source material. Its AI-generated responses and extracts are not legal advice and should be checked against the original documents.</p></section>
  </div>;
}

function Routed() {
  return <><ClerkInvalidator /><Switch>
    <Route path="/" component={Home} />
    <Route path="/sign-in/*?" component={() => <AuthPage mode="in" />} />
    <Route path="/sign-up/*?" component={() => <AuthPage mode="up" />} />
    <Route path="/dashboard">{() => <Protected>{(id: string) => <DashboardPage workspaceId={id} />}</Protected>}</Route>
    <Route path="/documents">{() => <Protected>{(id: string) => <DocumentsPage workspaceId={id} />}</Protected>}</Route>
    <Route path="/documents/:documentId">{params => <Protected>{() => <DocumentPage documentId={params.documentId} />}</Protected>}</Route>
    <Route path="/assistant">{() => <Protected>{(id: string) => <AssistantPage workspaceId={id} />}</Protected>}</Route>
    <Route path="/review">{() => <Protected>{(id: string) => <ReviewPage workspaceId={id} />}</Protected>}</Route>
    <Route path="/settings">{() => <Protected>{() => <SettingsPage />}</Protected>}</Route>
    <Route><main className="not-found"><Brand /><span className="eyebrow">404 / NOT IN THE RECORD</span><h1 className="serif">This page isn’t here.</h1><Link href="/" className="btn btn-primary" data-testid="link-return-home">Return home <ArrowRight size={15} /></Link></main></Route>
  </Switch></>;
}
function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your private document workspace' } }, signUp: { start: { title: 'Create your workspace', subtitle: 'Begin a careful review of your record' } } }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}><Routed /></ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkRouter /></WouterRouter></QueryClientProvider>;
}
export default App;