// lib/graphFetch.js
// Follows paging.next cursors and concatenates .data; caps pages to avoid runaway loops.
export async function fetchAll(url, { fetchImpl = fetch, maxPages = 20 } = {}) {
  const out = [];
  let next = url;
  let pages = 0;
  while (next && pages < maxPages) {
    const res = await fetchImpl(next);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    out.push(...(data.data || []));
    next = data.paging?.next || null;
    pages += 1;
  }
  return out;
}
