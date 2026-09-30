import React, { useEffect, useState } from 'react';
import { api, bytes } from './api.js';
import { Field, Modal, ErrorMessage } from './components.jsx';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
export function SettingsFields({ values, setValues, t }) {
  return <>
    <Field label={t.quota} type="number" min="0.001" step="any" required value={values.defaultQuota / GB} onChange={e => setValues({ ...values, defaultQuota: Math.round(Number(e.target.value) * GB) })} />
    <Field label={t.maxUpload} type="number" min="0.001" step="any" required value={values.maxUpload / MB} onChange={e => setValues({ ...values, maxUpload: Math.round(Number(e.target.value) * MB) })} />
    <Field label={t.retention} type="number" min="1" required value={values.trashDays} onChange={e => setValues({ ...values, trashDays: Number(e.target.value) })} />
    <label className="field"><span>{t.language}</span><select value={values.language} onChange={e => setValues({ ...values, language: e.target.value })}><option value="en">English</option><option value="fr">Français</option></select></label>
  </>;
}
export function Admin({ t }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('users');
  const [busy, setBusy] = useState(false);
  async function reload() {
    const [u, g, s] = await Promise.all([api('/admin/users'), api('/admin/groups'), api('/admin/settings')]);
    setUsers(u); setGroups(g); setSettings(s);
  }
  useEffect(() => { reload().catch(e => setError(e.message)); }, []);
  async function perform(fn) {
    setBusy(true); setError('');
    try { await fn(); await reload(); setEditing(null); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="tabs">{['users','groups','settings'].map(key => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{t[key]}</button>)}</div>
    <ErrorMessage error={error} />
    {tab === 'users' && <>
      <p className="muted">{t.privateNotice}</p>
      <button className="primary" onClick={() => { setError(''); setEditing({ type: 'user', username: '', password: '', quota: settings?.defaultQuota || 20 * GB, disabled: false }); }}>+ {t.addUser}</button>
      <div className="table-wrap"><table><thead><tr><th>{t.username}</th><th>{t.storage}</th><th>{t.disabled}</th><th /></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.username}</strong><small>{user.role}</small></td><td>{bytes(user.used)} / {bytes(user.quota)}</td><td>{user.disabled ? '✓' : '—'}</td><td><button onClick={() => { setError(''); setEditing({ ...user, password: '', type: 'user' }); }}>{t.edit}</button></td></tr>)}</tbody></table></div>
    </>}
    {tab === 'groups' && <>
      <button className="primary" onClick={() => { setError(''); setEditing({ type: 'group', name: '', members: [] }); }}>+ {t.newGroup}</button>
      <div className="group-cards">{groups.map(group => <article className="panel" key={group.id}><h3>◉ {group.name}</h3><p>{group.members.length} {t.members.toLowerCase()}</p><button onClick={() => { setError(''); setEditing({ ...group, type: 'group' }); }}>{t.edit}</button></article>)}</div>
    </>}
    {tab === 'settings' && settings && <form className="panel settings-form" onSubmit={e => { e.preventDefault(); perform(() => api('/admin/settings', { method: 'PUT', body: settings })); }}><SettingsFields values={settings} setValues={setSettings} t={t} /><button className="primary" disabled={busy}>{t.save}</button></form>}
    {editing && <Modal title={editing.type === 'user' ? (editing.id ? t.edit : t.addUser) : t.groups} close={() => setEditing(null)}>
      <ErrorMessage error={error} />
      <form onSubmit={e => {
        e.preventDefault();
        perform(async () => {
          if (editing.type === 'user') await api(`/admin/users${editing.id ? '/' + editing.id : ''}`, { method: editing.id ? 'PATCH' : 'POST', body: editing });
          else {
            const group = editing.id ? editing : await api('/admin/groups', { method: 'POST', body: { name: editing.name } });
            await api(`/admin/groups/${group.id}/members`, { method: 'PUT', body: { members: editing.members } });
          }
        });
      }}>
        {editing.type === 'user' ? <>
          <Field label={t.username} value={editing.username} required disabled={Boolean(editing.id)} onChange={e => setEditing({ ...editing, username: e.target.value })} />
          <Field label={editing.id ? t.resetPassword : t.password} type="password" autoComplete="new-password" required={!editing.id} minLength="12" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} />
          <Field label={t.userQuota} type="number" min="0.001" step="any" required value={editing.quota / GB} onChange={e => setEditing({ ...editing, quota: Math.round(Number(e.target.value) * GB) })} />
          {editing.id && editing.role !== 'admin' && <label className="check"><input type="checkbox" checked={Boolean(editing.disabled)} onChange={e => setEditing({ ...editing, disabled: e.target.checked })} />{t.disabled}</label>}
        </> : <>
          <Field label={t.name} required value={editing.name} disabled={Boolean(editing.id)} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          <h3>{t.members}</h3><div className="member-list">{users.map(user => <label className="check" key={user.id}><input type="checkbox" checked={editing.members.includes(user.id)} onChange={e => setEditing({ ...editing, members: e.target.checked ? [...editing.members, user.id] : editing.members.filter(id => id !== user.id) })} />{user.username}</label>)}</div>
          {editing.shares?.length > 0 && <><h3>{t.groupPhotos}</h3>{editing.shares.map(share => <div className="share-row" key={share.id}><span>{share.name}<small>{share.owner}</small></span><button type="button" onClick={() => perform(() => api(`/groups/${editing.id}/files/${share.id}`, { method: 'DELETE' }))}>{t.remove}</button></div>)}</>}
        </>}
        <div className="actions"><button className="primary" disabled={busy}>{t.save}</button><button type="button" onClick={() => setEditing(null)}>{t.cancel}</button>
          {editing.type === 'group' && editing.id && <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm(t.confirmGroup)) perform(() => api(`/admin/groups/${editing.id}`, { method: 'DELETE' })); }}>{t.remove}</button>}
        </div>
      </form>
    </Modal>}
  </section>;
}
