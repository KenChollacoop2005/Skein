const COMPACT_AT = 16; // stops before the print layout tightens

export function preparePrint(storeName, stopCount) {
  document.getElementById('print-store').textContent = storeName;
  document.getElementById('print-date').textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  document.body.classList.toggle('compact-print', stopCount >= COMPACT_AT);
}

export function printRoute(storeName, stopCount) {
  preparePrint(storeName, stopCount);
  window.print();
}
