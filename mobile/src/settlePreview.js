// Settled means no *tracked* handler/plugin tasks and a quiet commit interval.
// It is not a guarantee that arbitrary timers, animations or external work ended.
export async function settlePreview(read, { timeoutMs = 8000, quietMs = 200, generation, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + Math.max(0, timeoutMs);
  while (true) {
    const state = read();
    if (generation !== undefined && state.runtimeKey !== generation) return { settled: false, reason: 'runtime_replaced' };
    if (state.error) return { settled: false, reason: 'render_error' };
    if (!state.pendingTasks && now() - (state.lastActivity || 0) >= quietMs) return { settled: true, reason: 'quiet' };
    if (now() >= deadline) return { settled: false, reason: 'timeout', pendingTasks: state.pendingTasks || 0 };
    await sleep(Math.min(25, Math.max(1, deadline - now())));
  }
}
