import React, { useEffect, useRef } from 'react';

export function Logo({ large = false }) {
  return <div className={`brand ${large ? 'large' : ''}`}><img src="/logo.svg" alt="" /><span>Self<span className="brand-accent">Cloud</span></span></div>;
}
export function Modal({ title, close, children }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={close} onClick={event => { if (event.target === ref.current) close(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close / Fermer" onClick={close}>×</button></div>{children}
  </dialog>;
}
export function Field({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}
export function ErrorMessage({ error }) { return error ? <div className="error" role="alert">{error}</div> : null; }
