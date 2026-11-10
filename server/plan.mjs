// Turns the desktop app's task-list tool input into whiteboard text. Pure.

export function applyPlan(items, input = {}) {
  if (Array.isArray(input.items)) return input.items.map(({ content, status }) => ({ content, status }));
  const next = (items ?? []).map(i => ({ ...i }));
  if (input.advance) {
    const cur = next.findIndex(i => i.status === 'in_progress');
    if (cur >= 0) next[cur].status = 'completed';
    const pend = next.findIndex(i => i.status === 'pending');
    if (pend >= 0) next[pend].status = 'in_progress';
  }
  for (const n of input.done ?? []) if (next[n - 1]) next[n - 1].status = 'completed';
  if (next[input.start - 1]) next[input.start - 1].status = 'in_progress';
  return next;
}

export function planText(items) {
  const i = items.findIndex(x => x.status === 'in_progress');
  return i < 0 ? undefined : `${i + 1}/${items.length} · ${items[i].content}`;
}
