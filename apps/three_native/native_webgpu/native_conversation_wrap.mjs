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

// The Linux host can measure the authored face. Fit words using actual pixel
// advances, splitting only a token that cannot fit on an empty line.
export function wrapNativeReplyMeasured(value, maxWidth, measure) {
  if (typeof measure !== 'function') return wrapNativeReply(value, maxWidth);
  const rows = [];
  let row = '';
  const fits = text => measure(text) <= maxWidth;
  for (const original of String(value || '').trim().split(/\s+/)) {
    let word = original;
    if (!word) continue;
    while (!fits(word)) {
      if (row) { rows.push(row); row = ''; }
      const letters = [...word];
      let low = 1, high = letters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(letters.slice(0, middle).join(''))) low = middle;
        else high = middle - 1;
      }
      rows.push(letters.slice(0, low).join(''));
      word = letters.slice(low).join('');
    }
    const candidate = row ? `${row} ${word}` : word;
    if (row && !fits(candidate)) {
      rows.push(row);
      row = word;
    } else row = candidate;
  }
  if (row) rows.push(row);
  return rows;
}
