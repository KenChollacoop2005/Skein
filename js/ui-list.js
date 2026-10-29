const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function statusText(row) {
  if (row.skipped) return 'Skipped';
  if (row.pending) return 'Looking it up...';
  if (!row.spot) return 'Not found. Tap to choose or place it on the map.';
  return row.spot.where;
}

// One row per list line with its match
export function renderMatches(list, rows, { onPick, onPlace, onSkip, open }) {
  list.replaceChildren();
  for (const row of rows) {
    const li = node('li');
    const btn = node('button', 'match-line');
    btn.setAttribute('aria-expanded', String(open === row.key));
    const text = node('span', 'text');
    const title = node('b', null, `${cap(row.text)}: ${statusText(row)}`);
    if (row.spot?.approx) title.appendChild(node('span', 'tag approx', 'approximate'));
    if (row.spot?.manual) title.appendChild(node('span', 'tag', 'placed by you'));
    text.appendChild(title);
    if (row.item && !row.skipped) text.appendChild(node('span', null, row.item.name));
    btn.appendChild(text);
    li.appendChild(btn);
    btn.addEventListener('click', () => onPick(row.key, null));
    if (open === row.key) {
      const alts = node('ul', 'alts');
      for (const a of row.alts) {
        const b = node('button', null, a.item.name);
        if (row.item && a.item.id === row.item.id) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => onPick(row.key, a.item.id));
        const altLi = node('li');
        altLi.appendChild(b);
        alts.appendChild(altLi);
      }
      const place = node('button', null, 'Place it on the map');
      place.addEventListener('click', () => onPlace(row.key));
      const skip = node('button', null, row.skipped ? 'Include it again' : 'Skip this item');
      skip.addEventListener('click', () => onSkip(row.key));
      for (const b of [place, skip]) { const x = node('li'); x.appendChild(b); alts.appendChild(x); }
      li.appendChild(alts);
    }
    list.appendChild(li);
  }
}

export function renderChips(box, items, onAdd) {
  box.replaceChildren();
  for (const it of items) {
    const b = node('button', 'chip', it.term);
    b.addEventListener('click', () => onAdd(it.term));
    box.appendChild(b);
  }
}

export function renderRecent(box, lists, onLoad) {
  box.replaceChildren();
  if (!lists.length) return;
  box.appendChild(node('p', 'muted', 'Recent lists'));
  const row = node('div', 'row');
  for (const l of lists) {
    const b = node('button', null, l.label);
    b.title = l.text.replace(/\n/g, ', ');
    b.addEventListener('click', () => onLoad(l.text));
    row.appendChild(b);
  }
  box.appendChild(row);
}
