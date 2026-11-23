import { APP_PROMPT_PREFIX } from './agent-bridge.mjs';
// The model/session keeps its complete tool transcript. The human chat gets only
// conversational messages; tool inputs/results and intermediate narration stay out.
export function chatTranscript(messages) {
  return messages.flatMap(message => {
    if (!['user', 'assistant'].includes(message.role)) return [];
    const blocks = Array.isArray(message.content) ? message.content : [];
    if (message.role === 'assistant' && (message.stopReason === 'toolUse' || blocks.some(block => block.type === 'toolCall'))) return [];
    const text = typeof message.content === 'string' ? message.content : blocks.filter(block => block.type === 'text').map(block => block.text).join('\n');
    let visibleText = text;
    if (message.role === 'user' && text.startsWith(APP_PROMPT_PREFIX)) {
      try { const request = JSON.parse(text.slice(APP_PROMPT_PREFIX.length)); if (typeof request.text === 'string') visibleText = `From app (${request.source?.surface || 'unknown'}): ${request.text}`; }
      catch { /* Preserve ordinary text if it is not a valid app envelope. */ }
    }
    const display = visibleText.trim() || (message.errorMessage ? String(message.errorMessage).slice(0, 1000) : '');
    if (!display) return [];
    return [{ role: message.role, text: display.slice(0, 18000), timestamp: message.timestamp || 0 }];
  }).slice(-100);
}
const activities = {
  list: 'Looking through the app', read: 'Reading app code', write: 'Updating the app', edit: 'Updating the app',
  render: 'Rendering the preview', inspect: 'Checking the preview', screenshot: 'Looking at the preview', interact: 'Testing the app',
  deploy: 'Preparing your app for review', versions: 'Checking version history',
  plugins_list: 'Finding a suitable plugin', plugin_docs: 'Checking plugin capabilities', plugin_install: 'Preparing an approval request',
  plugin_call: 'Calling an approved service', app_bridge_docs: 'Checking agent bridge capabilities', app_describe: 'Checking the app interface', app_inspect: 'Reading exposed app state', app_invoke: 'Operating an app control', plugin_files: 'Working on a plugin', plugin_build: 'Building the plugin', plugin_publish: 'Preparing a plugin for review',
};
export const activityLabel = name => activities[name] || 'Working on your request';
