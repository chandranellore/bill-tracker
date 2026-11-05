/* Bill version comparison, run off the page thread. Paragraphs are aligned first; each replaced paragraph is then
   compared word by word with its most similar counterpart. */
importScripts("vendor/diff.min.js");

function similar(a, b) {
  const wa = new Set(a.toLowerCase().split(/\W+/)), wb = b.toLowerCase().split(/\W+/);
  let n = 0;
  for (const w of wb) if (wa.has(w)) n++;
  return n / Math.max(wa.size, wb.length, 1);
}

onmessage = e => {
  const { a, b } = e.data;
  let parts = Diff.diffArrays(a, b, { maxEditLength: 6000 });
  let coarse = false;
  if (!parts) { // too many differences for an alignment: show removed then added
    coarse = true;
    parts = [{ removed: true, value: a }, { added: true, value: b }];
  }
  const segs = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) { p.value.forEach(t => segs.push({ kind: "same", text: t })); continue; }
    if (p.removed && parts[i + 1] && parts[i + 1].added && !coarse) {
      const del = p.value, add = parts[i + 1].value;
      i++;
      const used = new Set();
      let j = 0;
      for (const d of del) {
        // pair this removed paragraph with the next similar added one, keeping order
        let k = -1;
        for (let x = j; x < Math.min(add.length, j + 4); x++) if (!used.has(x) && similar(d, add[x]) > 0.5) { k = x; break; }
        if (k < 0) { segs.push({ kind: "del", text: d }); continue; }
        for (; j < k; j++) segs.push({ kind: "add", text: add[j] });
        used.add(k); j = k + 1;
        const words = d.length + add[k].length < 40000 ? Diff.diffWordsWithSpace(d, add[k]) : [{ removed: true, value: d }, { added: true, value: add[k] }];
        segs.push({ kind: "chg", parts: words.map(w => ({ value: w.value, added: !!w.added, removed: !!w.removed })) });
      }
      for (; j < add.length; j++) if (!used.has(j)) segs.push({ kind: "add", text: add[j] });
      continue;
    }
    p.value.forEach(t => segs.push({ kind: p.added ? "add" : "del", text: t }));
  }
  postMessage({ segs, coarse });
};
