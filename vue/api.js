export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export function uploadFile(file, folder, progress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/files');
    request.upload.onprogress = event => progress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0);
    request.onerror = () => reject(new Error('Network error'));
    request.onload = () => {
      let result;
      try { result = JSON.parse(request.responseText); } catch { return reject(new Error(`HTTP ${request.status}`)); }
      request.status < 300 ? resolve(result) : reject(new Error(result.error));
    };
    const data = new FormData();
    data.append('name', file.name);
    if (folder) data.append('folder', folder);
    if (file.webkitRelativePath) data.append('relativePath', file.webkitRelativePath);
    data.append('file', file);
    request.send(data);
  });
}
export function bytes(value) {
  if (!value) return '0 B';
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${['B','KB','MB','GB','TB'][index]}`;
}
