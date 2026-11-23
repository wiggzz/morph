let pendingTasks = 0;
export const getPendingTasks = () => pendingTasks;
const publish = () => window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'activity', pendingTasks }));
export function beginTask() {
  pendingTasks++; publish();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true; pendingTasks = Math.max(0, pendingTasks - 1); publish();
  };
}
