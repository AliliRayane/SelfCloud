import React, { useEffect, useRef, useState } from 'react';
import { api, uploadFile, bytes } from './api.js';
import { translations } from './i18n.js';
import { Logo, Modal, Field, ErrorMessage } from './components.jsx';
import { Admin, SettingsFields } from './Admin.jsx';

export function App() {
  const [language, setLanguage] = useState(localStorage.getItem('language') || 'en');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const t = translations[language] || translations.en;
  useEffect(() => { document.documentElement.lang = language; localStorage.setItem('language', language); }, [language]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    Promise.all([api('/status'), api('/me').catch(() => null)]).then(([s, u]) => {
      setStatus(s); setUser(u);
      if (!localStorage.getItem('language')) setLanguage(s.language);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const controls = <div className="preferences"><select aria-label={t.language} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">EN</option><option value="fr">FR</option></select><button aria-label={t.theme} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button></div>;
  if (loading || !status) return <div className="welcome"><Logo large /><ErrorMessage error={error} />{loading && <span className="spinner" />}</div>;
  if (!user) return <div className="auth-layout">{controls}<div className="auth-art"><Logo large /><h1>{t.tagline}</h1><div className="cloud-art">☁</div></div><Auth t={t} status={status} onSetup={() => setStatus({ ...status, initialized: true })} onLogin={async () => setUser(await api('/me'))} /></div>;
  return <Drive t={t} user={user} setUser={setUser} controls={controls} language={language} />;
}

function Auth({ t, status, onSetup, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '', token: '', defaultQuota: 20 * 1024 ** 3, maxUpload: 2048 * 1024 ** 2, trashDays: 30, language: 'en' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  return <main className="auth-panel"><Logo /><h2>{status.initialized ? t.login : t.setup}</h2><p className="muted">{status.initialized ? t.tagline : t.setupIntro}</p><ErrorMessage error={error} />{notice && <p className="success" role="status">{notice}</p>}
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        if (status.initialized) { await api('/login', { method: 'POST', body: form }); await onLogin(); }
        else { await api('/setup', { method: 'POST', body: form }); setForm({ ...form, token: '', password: '' }); onSetup(); setNotice(t.setupDone); }
      } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      {!status.initialized && <Field label={t.token} type="password" required value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />}
      <Field label={t.username} autoComplete="username" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
      <Field label={t.password} type="password" autoComplete={status.initialized ? 'current-password' : 'new-password'} required minLength={status.initialized ? undefined : 12} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
      {!status.initialized && <><small className="muted">{t.passwordHint}</small><SettingsFields values={form} setValues={setForm} t={t} /></>}
      <button className="primary full" disabled={busy}>{busy ? '…' : status.initialized ? t.login : t.create}</button>
    </form>
  </main>;
}

function Drive({ t, user, setUser, controls, language }) {
  const [view, setView] = useState('drive');
  const [group, setGroup] = useState(null);
  const [folder, setFolder] = useState(null);
  const [groups, setGroups] = useState([]);
  const [tree, setTree] = useState([]);
  const [items, setItems] = useState({ files: [], folders: [], hasMore: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState(null);
  const [account, setAccount] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef();
  const directoryInput = useRef();
  const requestId = useRef(0);
  const uploading = useRef(false);
  const selectionId = useRef(0);
  const query = (offset = 0) => new URLSearchParams({ ...(folder && view === 'drive' ? { folder } : {}), ...(view === 'trash' ? { trash: 'true' } : {}), ...(view === 'photos' || view === 'group' ? { photos: 'true' } : {}), ...(group && view === 'group' ? { group: group.id } : {}), offset });
  async function reload(append = false) {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const [result, g, folders, me] = await Promise.all([api(`/files?${query(append ? items.files.length : 0)}`), api('/groups'), api('/folders'), api('/me')]);
      if (id !== requestId.current) return;
      setItems(previous => ({ ...result, files: append ? [...previous.files, ...result.files] : result.files })); setGroups(g); setTree(folders); setUser(me);
    } catch (e) { if (id === requestId.current) setError(e.message); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  useEffect(() => { setError(''); setItems({ files: [], folders: [], hasMore: false }); reload(); }, [view, folder, group?.id]);
  useEffect(() => {
    if (!items.files.some(file => ['pending', 'processing'].includes(file.state))) return;
    const timer = setTimeout(() => reload(), 2500);
    return () => clearTimeout(timer);
  }, [items]);
  async function perform(fn) {
    setError('');
    try { await fn(); await reload(); } catch (e) { setError(e.message); }
  }
  function navigate(next, g = null) { ++selectionId.current; setView(next); setGroup(g); setFolder(null); setSelected(null); }
  async function upload(files) {
    if (uploading.current) return;
    uploading.current = true;
    const batch = Array.from(files);
    const destination = folder;
    setUploads(batch.map(file => ({ name: file.webkitRelativePath || file.name, progress: 0, state: 'waiting' })));
    for (let index = 0; index < batch.length; index++) {
      const update = patch => setUploads(previous => previous.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
      try {
        if (batch[index].size > user.maxUpload) throw new Error(`${t.maxUpload}: ${bytes(user.maxUpload)}`);
        update({ state: 'uploading' });
        await uploadFile(batch[index], destination, progress => update({ progress }));
        update({ state: 'done', progress: 100 });
      } catch (e) { update({ state: 'error', error: e.message }); }
    }
    uploading.current = false;
    await reload();
  }
  async function open(file) {
    const id = ++selectionId.current;
    try { const details = await api(`/files/${file.id}`); if (id === selectionId.current) setSelected(details); } catch (e) { setError(e.message); }
  }
  const photoView = view === 'photos' || view === 'group';
  const currentFolder = tree.find(entry => entry.id === folder);
  const title = view === 'group' ? group.name : view === 'drive' && currentFolder ? currentFolder.name : t[view];
  const trail = [];
  let ancestor = currentFolder;
  while (ancestor && trail.length < 100) { trail.unshift(ancestor); ancestor = tree.find(entry => entry.id === ancestor.parent_id); }
  const percent = Math.min(100, user.used / user.quota * 100);
  return <div className="app-layout">
    <aside className="sidebar"><Logo /><nav>{[['drive','▤'],['photos','▧'],['trash','♲']].map(([key, icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)}><span>{icon}</span>{t[key]}</button>)}
      <div className="nav-label">{t.groups}</div>{groups.length ? groups.map(g => <button key={g.id} className={group?.id === g.id ? 'active' : ''} onClick={() => navigate('group', g)}><span>◉</span>{g.name}</button>) : <p className="nav-hint">{t.noGroups}</p>}
      {user.role === 'admin' && <button className={view === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}><span>⚙</span>{t.admin}</button>}
    </nav><div className="sidebar-bottom"><div className="storage"><span>{bytes(user.used)} {t.of} {bytes(user.quota)}</span><progress value={percent} max="100" /></div><button className="account-button" onClick={() => setAccount(true)}><span className="avatar">{user.username[0].toUpperCase()}</span><strong>{user.username}</strong></button><button className="subtle" onClick={() => perform(async () => { await api('/logout', { method: 'POST' }); setUser(null); })}>{t.logout}</button></div></aside>
    <main className="main-content" onDragOver={e => { if (view === 'drive' || view === 'photos') { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (view === 'drive' || view === 'photos') upload(e.dataTransfer.files); }}>
      <header><div><p className="eyebrow">{view === 'group' ? t.groupPhotos : 'SELFCLOUD'}</p><h1>{title}</h1></div>{controls}</header>
      <ErrorMessage error={error} />
      {view === 'admin' ? <Admin t={t} /> : <>
        <div className="toolbar">
          {(view === 'drive' || view === 'photos') && <><button className="primary" onClick={() => fileInput.current.click()} disabled={uploading.current}>↑ {t.upload}</button><button onClick={() => directoryInput.current.click()} disabled={uploading.current}>{t.uploadFolder}</button></>}
          {view === 'drive' && <button onClick={() => setEdit({ type: 'folder', name: '' })}>+ {t.newFolder}</button>}
          <button className="refresh" aria-label={t.refresh} onClick={() => reload()} disabled={busy}>↻</button>
        </div>
        <input hidden ref={fileInput} type="file" multiple onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        <input hidden ref={directoryInput} type="file" multiple webkitdirectory="" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        {view === 'drive' && <div className="breadcrumbs"><button onClick={() => setFolder(null)}>{t.root}</button>{trail.map(f => <React.Fragment key={f.id}><span>/</span><button onClick={() => setFolder(f.id)}>{f.name}</button></React.Fragment>)}</div>}
        {items.folders.length > 0 && <div className="folder-grid">{items.folders.map(f => <article key={f.id} className="folder-card"><button onClick={() => setFolder(f.id)}><span>▰</span>{f.name}</button><button aria-label={t.edit} onClick={() => setEdit({ type: 'folder', ...f })}>⋯</button></article>)}</div>}
        {!items.files.length && !items.folders.length && <div className="empty-state"><img src="/logo.svg" alt="" /><h2>{busy ? '…' : t.empty}</h2><p>{t.emptyHint}</p></div>}
        {photoView ? <div className="photo-timeline">{items.files.map((file, index) => {
          const month = new Date(file.captured_at || file.uploaded_at).toLocaleDateString(language, { month: 'long', year: 'numeric' });
          const previous = index && new Date(items.files[index - 1].captured_at || items.files[index - 1].uploaded_at).toLocaleDateString(language, { month: 'long', year: 'numeric' });
          return <React.Fragment key={file.id}>{month !== previous && <h2 className="month-heading">{month}</h2>}<button className="photo-card" onClick={() => open(file)}><PhotoThumbnail file={file} t={t} /><span>{file.name}</span></button></React.Fragment>;
        })}</div> : items.files.length > 0 && <div className="table-wrap"><table><thead><tr><th>{t.name}</th><th>{t.size}</th><th>{t.date}</th><th /></tr></thead><tbody>{items.files.map(file => <tr key={file.id}><td><button className="file-name" onClick={() => open(file)}><span className="file-icon">{file.is_photo ? '▧' : '▤'}</span>{file.name}</button></td><td>{bytes(file.size)}</td><td>{new Date(file.uploaded_at).toLocaleDateString(language)}</td><td><button aria-label={t.details} onClick={() => open(file)}>⋯</button></td></tr>)}</tbody></table></div>}
        {items.hasMore && <button className="load-more" onClick={() => reload(true)} disabled={busy}>{t.loadMore}</button>}
      </>}
      {dragging && <div className="drop-overlay">↑<strong>{t.drop}</strong></div>}
      {uploads.length > 0 && <section className="upload-panel" aria-label={t.uploads}><div className="modal-header"><h3>{t.uploads}</h3>{!uploading.current && <button onClick={() => setUploads([])} aria-label={t.close}>×</button>}</div>{uploads.map((entry, index) => <div className="upload-entry" key={index}><span>{entry.name}</span><small className={entry.state === 'error' ? 'danger-text' : ''}>{entry.state === 'done' ? t.done : entry.error || `${entry.progress}%`}</small><progress value={entry.progress} max="100" /></div>)}</section>}
    </main>
    {selected && <Modal title={selected.name} close={() => { ++selectionId.current; setSelected(null); }}><FileViewer file={selected} files={items.files} open={open} user={user} groups={groups} group={group} t={t} language={language} onEdit={() => { setEdit({ type: 'file', ...selected }); setSelected(null); }} perform={perform} close={() => setSelected(null)} refreshDetails={async () => setSelected(await api(`/files/${selected.id}`))} /></Modal>}
    {edit && <Modal title={edit.type === 'folder' ? (edit.id ? t.edit : t.newFolder) : t.edit} close={() => setEdit(null)}><ErrorMessage error={error} /><form onSubmit={e => {
      e.preventDefault(); perform(async () => {
        if (edit.type === 'folder') await api(`/folders${edit.id ? '/' + edit.id : ''}`, { method: edit.id ? 'PATCH' : 'POST', body: { name: edit.name, parent: edit.id ? edit.parent_id : folder } });
        else await api(`/files/${edit.id}`, { method: 'PATCH', body: { name: edit.name, folder: edit.folder_id } });
        setEdit(null);
      });
    }}><Field label={t.name} value={edit.name} required onChange={e => setEdit({ ...edit, name: e.target.value })} />
      {edit.id && <label className="field"><span>{t.chooseFolder}</span><select value={(edit.type === 'file' ? edit.folder_id : edit.parent_id) || ''} onChange={e => setEdit({ ...edit, [edit.type === 'file' ? 'folder_id' : 'parent_id']: e.target.value || null })}><option value="">{t.root}</option>{tree.filter(f => f.id !== edit.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      <div className="actions"><button className="primary">{t.save}</button><button type="button" onClick={() => setEdit(null)}>{t.cancel}</button>{edit.type === 'folder' && edit.id && <button className="danger" type="button" onClick={() => perform(async () => { await api(`/folders/${edit.id}`, { method: 'DELETE' }); setEdit(null); })}>{t.deleteFolder}</button>}</div>
    </form></Modal>}
    {account && <Account t={t} close={() => setAccount(false)} signedOut={() => setUser(null)} />}
  </div>;
}

function PhotoThumbnail({ file, t }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [file.state, file.id]);
  return file.state === 'ready' && !failed ? <img loading="lazy" src={`/api/files/${file.id}/preview`} alt={file.name} onError={() => setFailed(true)} /> : <div className="photo-placeholder"><span>▧</span><small>{['pending','processing'].includes(file.state) ? t.processing : t.unsupported}</small></div>;
}

function FileViewer({ file, files, open, user, groups, group, t, language, onEdit, perform, close, refreshDetails }) {
  const own = file.owner_id === user.id;
  const index = files.findIndex(f => f.id === file.id);
  const act = (path, method = 'POST') => perform(async () => { await api(path, { method }); close(); });
  return <div className="file-viewer">
    {file.is_photo && <div className="viewer-image"><PhotoThumbnail file={file} t={t} /></div>}
    <div className="viewer-nav"><button disabled={index <= 0} onClick={() => open(files[index - 1])}>←</button><span>{index + 1} / {files.length}</span><button disabled={index < 0 || index >= files.length - 1} onClick={() => open(files[index + 1])}>→</button></div>
    <div className="actions"><a className="button primary" href={`/api/files/${file.id}/download`}>{t.download}</a>{own && !file.trashed_at && <><button onClick={onEdit}>{t.edit}</button><button className="danger" onClick={() => act(`/files/${file.id}/trash`)}>{t.delete}</button></>}{own && file.trashed_at && <><button onClick={() => act(`/files/${file.id}/restore`)}>{t.restore}</button><button className="danger" onClick={() => { if (confirm(t.confirmDelete)) act(`/files/${file.id}`, 'DELETE'); }}>{t.permanentlyDelete}</button></>}{group && (own || user.role === 'admin') && <button onClick={() => act(`/groups/${group.id}/files/${file.id}`, 'DELETE')}>{t.unshare}</button>}</div>
    <dl><dt>{t.size}</dt><dd>{bytes(file.size)}</dd><dt>{t.date}</dt><dd>{new Date(file.uploaded_at).toLocaleString(language)}</dd>{file.captured_at && <><dt>{t.capture}</dt><dd>{new Date(file.captured_at).toLocaleString(language)}</dd></>}{file.width && <><dt>Dimensions</dt><dd>{file.width} × {file.height}</dd></>}<dt>SHA-256</dt><dd className="hash">{file.hash}</dd></dl>
    {own && !file.trashed_at && file.is_photo && groups.length > 0 && <section><h3>{t.sharing}</h3>{groups.map(g => <label className="check" key={g.id}><input type="checkbox" checked={file.shares?.includes(g.id) || false} onChange={e => perform(async () => { await api(`/groups/${g.id}/files/${file.id}`, { method: e.target.checked ? 'PUT' : 'DELETE' }); await refreshDetails(); })} />{g.name}</label>)}</section>}
    {file.processing_error && <p className="muted">{file.processing_error}</p>}
    <details><summary>{t.metadata}</summary><pre>{JSON.stringify(file.metadata, null, 2)}</pre></details>
  </div>;
}

function Account({ t, close, signedOut }) {
  const [values, setValues] = useState({ currentPassword: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Modal title={t.account} close={close}><ErrorMessage error={error} /><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api('/password', { method: 'POST', body: values }); signedOut(); } catch (err) { setError(err.message); } finally { setBusy(false); } }}><Field label={t.currentPassword} type="password" autoComplete="current-password" required value={values.currentPassword} onChange={e => setValues({ ...values, currentPassword: e.target.value })} /><Field label={t.newPassword} type="password" autoComplete="new-password" minLength="12" required value={values.password} onChange={e => setValues({ ...values, password: e.target.value })} /><p className="muted">{t.passwordHint}</p><button className="primary" disabled={busy}>{t.changePassword}</button></form></Modal>;
}
