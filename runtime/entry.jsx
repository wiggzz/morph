// React runs here, in a separate WebView JS realm. Only data and UI events cross the bridge.
import React from 'react';
import Reconciler from 'react-reconciler';
import App from 'virtual:App';
import registerTools from 'virtual:Tools';
import {loadTools} from './pi-tools';
import { beginTask, getPendingTasks } from './activity';

const send = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
let nextID = 0;
let eventHandlers = new Map();
let treeRoot = { children: [] };
let commits = 0;
let timer;
const error = e => send({ type: 'error', error: String(e?.message || e).slice(0, 4000), diagnostics: { code: 'RUNTIME_JS', stack: String(e?.stack || '').slice(0, 4000) } });
window.onerror = (message, source, line, column, e) => error(e || message);
window.onunhandledrejection = e => error(e.reason);

function serialize(node) {
  if (node.text !== undefined) return node.text;
  const props = {};
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children' || key === 'ref' || key === 'key') continue;
    if (typeof value === 'function') {
      if (/^on[A-Z]/.test(key)) {
        const id = node.id + ':' + key;
        eventHandlers.set(id, value);
        props[key] = { event: id };
      }
    } else props[key] = value;
  }
  return { id: node.id, type: node.type, props, children: node.children.map(serialize) };
}
function publish() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      eventHandlers = new Map();
      send({ type: 'tree', revision: ++commits, pendingTasks: getPendingTasks(), tree: treeRoot.children.map(serialize) });
    } catch (e) { error(e); }
  }, 0);
}
function append(parent, child) {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
  parent.children.push(child);
}
function remove(parent, child) {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
}
function insert(parent, child, before) {
  remove(parent, child);
  parent.children.splice(parent.children.indexOf(before), 0, child);
}
const renderer = Reconciler({
  supportsMutation: true,
  isPrimaryRenderer: true,
  now: Date.now,
  getRootHostContext: () => ({}), getChildHostContext: () => ({}),
  getPublicInstance: instance => ({ id: instance.id }),
  prepareForCommit: () => null, resetAfterCommit: publish,
  createInstance: (type, props) => ({ id: String(++nextID), type, props, children: [] }),
  createTextInstance: text => ({ id: String(++nextID), text }),
  appendInitialChild: append, appendChild: append, appendChildToContainer: append,
  removeChild: remove, removeChildFromContainer: remove,
  insertBefore: insert, insertInContainerBefore: insert,
  finalizeInitialChildren: () => false,
  prepareUpdate: () => true,
  commitUpdate: (instance, payload, type, oldProps, props) => { instance.props = props; },
  commitTextUpdate: (instance, oldText, text) => { instance.text = text; },
  shouldSetTextContent: () => false,
  clearContainer: container => { container.children = []; },
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  getCurrentEventPriority: () => 16,
  supportsPersistence: false, supportsHydration: false,
  beforeActiveInstanceBlur() {}, afterActiveInstanceBlur() {},
  preparePortalMount() {}, detachDeletedInstance() {},
  hideInstance() {}, unhideInstance() {}, hideTextInstance() {}, unhideTextInstance() {},
});
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(e) { error(e); }
  render() { return this.state.error ? null : this.props.children; }
}
const root = renderer.createContainer(treeRoot, 0, null, false, null, '', error, null);
window.__morphEvent = (event, value, requestId) => {
  try {
    const handler = eventHandlers.get(event);
    if (!handler) throw new Error('Event no longer exists: ' + event);
    let result;
    renderer.batchedUpdates(() => { result = handler(value); });
    if (result && typeof result.then === 'function') {
      const finish = beginTask();
      Promise.resolve(result).then(() => { finish(); publish(); }, e => { finish(); error(e); });
    }
    // Always publish, including handlers which did not change state.
    publish();
    if (requestId) setTimeout(() => send({ type: 'event_done', requestId }), 40);
  } catch (e) {
    if (requestId) send({ type: 'event_done', requestId, error: String(e) });
    else error(e);
  }
};
try { const start=()=>renderer.updateContainer(<Boundary><App /></Boundary>, root, null, () => {}); if(__MORPH_CHAT__)loadTools(registerTools).then(start,error);else start(); }
catch (e) { error(e); }
