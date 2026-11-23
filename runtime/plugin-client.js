// This module lives inside the editable WebView, and contains no credentials or control-plane token.
import { beginTask } from './activity';
const pending = new Map();
let counter = 0;
window.__morphPluginResult = message => {
  const waiter = pending.get(message.requestId);
  if (!waiter) return;
  pending.delete(message.requestId); clearTimeout(waiter.timer); waiter.finish();
  message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.data);
};
function request(payload) {
    if (pending.size >= 16) return Promise.reject(new Error('Too many pending plugin calls'));
    const requestId = 'plugin-' + (++counter);
    const message = JSON.stringify({requestId,...payload});
    if (message.length > 18000) return Promise.reject(new Error('Plugin request is too large'));
    return new Promise((resolve, reject) => {
      const finish = beginTask();
      const timer = setTimeout(() => { pending.delete(requestId); finish(); reject(new Error('Plugin request timed out')); }, 30000);
      pending.set(requestId, { resolve, reject, timer, finish });
      try { window.ReactNativeWebView.postMessage(message); }
      catch (error) { pending.delete(requestId); clearTimeout(timer); finish(); reject(error); }
    });
}
export const plugins = {
  call: (plugin,method,args = {}) => request({type:'plugin_call',plugin,method,args}),
  open: (plugin,options = {}) => request({type:'plugin_instance',action:'open',plugin,options}),
  instances: () => request({type:'plugin_instance',action:'list'}),
  instance: id => ({id,call:(method,args = {}) => request({type:'plugin_call',plugin:id,method,args})}),
};
