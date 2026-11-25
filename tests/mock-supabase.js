// Browser-only fake. Loaded by the local test server instead of the CDN client.
window.mock = { rows: [], uploads: [], objects: new Map(), failUpload: false,
  failWrite: false, failSign: false, conflict: false, alerts: [], downloads: 0 };
window.alert = message => mock.alerts.push(message);
HTMLAnchorElement.prototype.click = function () { mock.downloads++; };
class Query {
  constructor() { this.operation = 'read'; this.filters = []; }
  select() { return this; }
  order() { return this; }
  eq(key,value) { this.filters.push(row => row[key] === value); return this; }
  filter(key,operator,value) {
    this.filters.push(row => operator === 'is' ? row[key] == null : JSON.stringify(row[key]) === value);
    return this;
  }
  update(value) { this.operation = 'update'; this.value = value; return this; }
  upsert(value) { this.operation = 'upsert'; this.value = JSON.parse(JSON.stringify(value)); return this; }
  insert(value) { this.operation = 'insert'; this.value = JSON.parse(JSON.stringify(value)); return this; }
  delete() { this.operation = 'delete'; return this; }
  then(resolve,reject) {
    return Promise.resolve().then(() => {
      if (this.operation !== 'read' && mock.failWrite) return { data: null, error: { message: 'Test databasefout' } };
      if (this.operation === 'read') return { data: JSON.parse(JSON.stringify(mock.rows)), error: null };
      if (this.operation === 'upsert' || this.operation === 'insert') {
        const index = mock.rows.findIndex(row => row.id === this.value.id);
        if (index >= 0 && this.operation === 'insert') return { data: null, error: { message: 'Duplicate id' } };
        if (index >= 0) mock.rows[index] = this.value; else mock.rows.push(this.value);
        return { data: [{ id: this.value.id }], error: null };
      }
      let matched = mock.rows.filter(row => this.filters.every(fn => fn(row)));
      if (mock.conflict) matched = [];
      if (this.operation === 'update') matched.forEach(row => Object.assign(row, JSON.parse(JSON.stringify(this.value))));
      if (this.operation === 'delete') mock.rows = mock.rows.filter(row => !matched.includes(row));
      return { data: matched.map(row => ({id:row.id})), error: null };
    }).then(resolve,reject);
  }
}
window.supabase = { createClient() { return {
  from() { return new Query(); },
  channel() { return { on() { return this; }, subscribe() {} }; },
  storage: { from(bucket) { return {
    async upload(path,body,options) {
      if (mock.failUpload) return { error: { message: 'Test uploadfout' } };
      mock.uploads.push({ bucket, path, body, options });
      mock.objects.set(path, body);
      return { data: { path }, error: null };
    },
    async createSignedUrls(paths) {
      if (mock.failSign) return { data: null, error: {message:'Test linkfout'} };
      return { data: paths.map(path => ({ path, signedUrl: URL.createObjectURL(mock.objects.get(path) || new Blob()) })), error: null };
    }
  }; } }
}; } };
