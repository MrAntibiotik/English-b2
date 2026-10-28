// Синхронізація прогресу через GitHub Gist.
// Токен (дозвіл лише "gist") і id gist-а зберігаються в localStorage цього браузера.
// У gist лежить progress.json: { updatedAt, data: { <ключ localStorage>: <значення> } }.
// Під час конфлікту перемагає новіша версія (за updatedAt).
(function(){
  const KEYS = ['cw_state', 'eb_last'];
  const FILE = 'progress.json';
  const DESC = 'english-b2-progress';
  const API = 'https://api.github.com';

  function get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function set(k, v){ try{ v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} }

  let status = get('sync_token') ? 'Очікує синхронізації' : 'Синхронізацію не налаштовано';
  const listeners = [];
  function setStatus(s){ status = s; listeners.forEach(f => f(s)); }

  async function api(path, opts){
    const r = await fetch(API + path, Object.assign({}, opts, {
      headers: { 'Authorization': 'Bearer ' + get('sync_token'),
                 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json' }
    }));
    if(r.status === 401) throw new Error('Невірний токен');
    if(!r.ok) throw new Error('GitHub: ' + r.status);
    return r.json();
  }

  function snapshot(){
    const data = {};
    KEYS.forEach(k => { const v = get(k); if(v !== null) data[k] = v; });
    return { updatedAt: Number(get('sync_updated') || 0), data };
  }

  async function findGist(){
    let id = get('sync_gist');
    if(id) return id;
    const list = await api('/gists?per_page=100');
    const g = list.find(x => x.description === DESC && x.files[FILE]);
    if(g){ set('sync_gist', g.id); return g.id; }
    const created = await api('/gists', { method: 'POST', body: JSON.stringify({
      description: DESC, public: false,
      files: { [FILE]: { content: JSON.stringify(snapshot(), null, 1) } } }) });
    set('sync_gist', created.id);
    return created.id;
  }

  async function push(){
    if(!get('sync_token')) return;
    try{
      setStatus('Зберігаю…');
      const id = await findGist();
      await api('/gists/' + id, { method: 'PATCH', body: JSON.stringify({
        files: { [FILE]: { content: JSON.stringify(snapshot(), null, 1) } } }) });
      setStatus('Збережено на GitHub ' + new Date().toLocaleTimeString());
    }catch(e){ setStatus('Помилка: ' + e.message); }
  }

  // Повертає true, якщо з GitHub прийшла новіша версія і її записано в localStorage.
  async function pull(){
    if(!get('sync_token')) return false;
    try{
      setStatus('Завантажую…');
      const id = await findGist();
      const g = await api('/gists/' + id);
      const f = g.files[FILE];
      const remote = f ? JSON.parse(f.content || '{}') : {};
      const local = snapshot();
      if((remote.updatedAt || 0) > local.updatedAt){
        KEYS.forEach(k => set(k, remote.data && k in remote.data ? remote.data[k] : null));
        set('sync_updated', String(remote.updatedAt));
        setStatus('Завантажено з GitHub');
        return true;
      }
      if(local.updatedAt > (remote.updatedAt || 0)) await push();
      else setStatus('Синхронізовано');
      return false;
    }catch(e){ setStatus('Помилка: ' + e.message); return false; }
  }

  let timer = null;
  // Викликати після кожної зміни прогресу.
  function changed(){
    set('sync_updated', String(Date.now()));
    clearTimeout(timer);
    timer = setTimeout(push, 2000);
  }
  // Дозберегти, якщо сторінку закривають до спрацювання таймера.
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden' && timer){ clearTimeout(timer); timer = null; push(); }
  });

  window.Sync = {
    pull, push, changed,
    status: () => status,
    onStatus: f => { listeners.push(f); f(status); },
    configured: () => !!get('sync_token'),
    setToken(t){ set('sync_token', t || null); set('sync_gist', null);
      setStatus(t ? 'Очікує синхронізації' : 'Синхронізацію не налаштовано'); }
  };
})();
