// Keep replies readable inside the native text atlas without dropping words.
export function wrapNativeReply(value, limit) {
  limit = Math.max(1, Math.floor(limit) || 1);
  const rows = [];
  let row = '';
  for (const original of String(value || '').trim().split(/\s+/)) {
    let word = original;
    if (!word) continue;
    while (word.length > limit) {
      if (row) { rows.push(row); row = ''; }
      rows.push(word.slice(0, limit));
      word = word.slice(limit);
    }
    if (row && row.length + word.length + 1 > limit) {
      rows.push(row); row = '';
    }
    row += (row ? ' ' : '') + word;
  }
  if (row) rows.push(row);
  return rows;
}
