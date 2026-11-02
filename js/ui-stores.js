import { SOURCE_LABELS } from './stores.js';

const $ = id => document.getElementById(id);

function button(text, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileName = name => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store'}.json`;

// Store picker and the manage sheet
export async function mountStores(stores, currentId) {
  const status = msg => { $('stores-status').textContent = msg; };
  const use = id => { stores.setCurrent(id); location.reload(); };

  async function render() {
    const all = await stores.list();
    const sel = $('store-select');
    sel.replaceChildren(...all.map(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      o.selected = s.id === currentId;
      return o;
    }));
    const list = $('store-list');
    list.replaceChildren();
    for (const s of all) {
      const li = document.createElement('li');
      const title = document.createElement('b');
      title.textContent = s.name;
      const meta = document.createElement('span');
      meta.className = 'small muted';
      meta.textContent = [SOURCE_LABELS[s.source] || '', s.id === currentId ? 'in use now' : '', s.note || ''].filter(Boolean).join('. ');
      const row = document.createElement('div');
      row.className = 'row';
      if (s.id !== currentId) row.append(button('Use', () => use(s.id), 'primary'));
      row.append(button('Copy', async () => { try { await stores.copy(s.id); status(`Copied ${s.name}.`); render(); } catch (e) { status(e.message); } }));
      row.append(button('Download', async () => download(fileName(s.name), await stores.layoutOf(s.id))));
      if (s.source !== 'shipped') {
        row.append(button('Rename', () => {
          const name = prompt('New name for this store', s.name);
          if (name && stores.rename(s.id, name)) render();
        }));
        row.append(button('Delete', () => {
          if (!confirm(`Delete ${s.name} from this phone?`)) return;
          stores.remove(s.id);
          if (s.id === currentId) location.reload(); else render();
        }));
      }
      li.append(title, meta, row);
      list.appendChild(li);
    }
  }

  $('store-select').addEventListener('change', e => use(e.target.value));
  $('stores-btn').addEventListener('click', () => $('stores-sheet').showModal());
  $('store-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = stores.importText(await file.text(), file.name);
      status('Added. Tap Use to switch to it.');
      await render();
      $('store-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
      return id;
    } catch (err) {
      status(err.message);
    }
  });
  await render();
}
