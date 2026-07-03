/* REST client for the PumpSathi API. Handles JWT + errors. */
'use strict';
const API = {
  base: '/api',
  token: localStorage.getItem('afs_token') || '',
  user: null,

  async req(method, path, body, noAuth) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token && !noAuth) headers.Authorization = 'Bearer ' + this.token;
    let res;
    try { res = await fetch(this.base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (e) { const err = new Error('Cannot reach the server. Is it running?'); err.network = true; throw err; }
    if (res.status === 401) { this.token = ''; localStorage.removeItem('afs_token'); const e = new Error('unauthorized'); e.unauth = true; throw e; }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  },

  config() { return this.req('GET', '/config', undefined, true); },
  async login(mobile, password) {
    const r = await this.req('POST', '/auth/login', { mobile, password }, true);
    this.token = r.token; this.user = r.user; localStorage.setItem('afs_token', r.token); return r;
  },
  logout() { this.token = ''; this.user = null; localStorage.removeItem('afs_token'); location.reload(); },

  getState() { return this.req('GET', '/state'); },
  create(coll, rec) { return this.req('POST', '/c/' + coll, rec); },
  update(coll, id, rec) { return this.req('PUT', '/c/' + coll + '/' + id, rec); },
  remove(coll, id) { return this.req('DELETE', '/c/' + coll + '/' + id); },
  setKV(key, value) { return this.req('PUT', '/kv/' + key, { value }); },
  clearData() { return this.req('POST', '/admin/clear'); },
  importData(doc) { return this.req('POST', '/admin/import', doc); },

  listUsers() { return this.req('GET', '/users'); },
  addUser(mobile, name, password, role) { return this.req('POST', '/users', { mobile, name, password, role }); },
  delUser(id) { return this.req('DELETE', '/users/' + id); },

  listFirms() { return this.req('GET', '/firms'); },
  addFirm(payload) { return this.req('POST', '/firms', payload); },

  alertTest(type, date) { return this.req('POST', '/alerts/test', { type, date }); },
  alertRecent() { return this.req('GET', '/alerts/recent'); },
  audit() { return this.req('GET', '/audit'); },
  overview() { return this.req('GET', '/admin/overview'); },
  impersonate(firmId) { return this.req('POST', '/admin/impersonate', { firmId }); },
};
