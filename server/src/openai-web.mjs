// OpenAI executes these hosted tools. No website fetcher, browser process,
// additional API key, or app-runtime inference endpoint is exposed by Morph.
export function supportsOpenAIWeb(model) {
  return (model?.provider === 'openai-codex' && model.api === 'openai-codex-responses') ||
    (model?.provider === 'openai' && model.api === 'openai-responses' && model.baseUrl === 'https://api.openai.com/v1');
}
export function withOpenAIWeb(payload,model) {
  if (!supportsOpenAIWeb(model) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  if (tools.some(t => t?.type === 'web_search' || t?.type === 'web_search_preview')) return payload;
  return {...payload,tools:[...tools,{type:'web_search',external_web_access:true}]};
}
function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
function label(value) {return String(value).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160).replace(/[\\\[\]`*_]/g,'\\$&');}
export function citeWebText(part) {
  if (part?.type !== 'output_text' || typeof part.text !== 'string' || !Array.isArray(part.annotations)) return;
  const sources = new Map();
  for (const a of part.annotations) {
    const url = a?.type === 'url_citation' ? sourceURL(a.url) : null;
    if (url && !sources.has(url) && sources.size < 24) sources.set(url,label(a.title || new URL(url).hostname));
  }
  if (!sources.size) return;
  // Current Codex models already produce Markdown citations. Retain those.
  // Other models may emit ChatGPT-only citation glyphs; replace those with a
  // source list instead of leaving unreadable private-use markers in chat.
  let text = part.text.replace(/\uE200cite\uE202[^\uE201]*\uE201/g,'');
  const markdownURL = url => url.replace(/[()<>]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const missing = [...sources].filter(([url]) => !text.includes(url) && !text.includes(markdownURL(url)));
  if (missing.length) text += '\n\nSources:\n'+missing.map(([url,title]) => `- [${title}](${markdownURL(url)})`).join('\n');
  part.text = text;
}
export function attachOpenAIWeb(agent,{onActivity=()=>{}} = {}) {
  const priorPayload=agent.onPayload, priorEvent=agent.onProviderStreamEvent;
  let activity=null;
  const status=value=>{if(activity!==value){activity=value;onActivity(value);}};
  agent.onPayload=async(payload,model)=>{
    status(null);
    const changed=await priorPayload?.(payload,model);
    return withOpenAIWeb(changed===undefined?payload:changed,model);
  };
  agent.onProviderStreamEvent=async(event,model)=>{
    await priorEvent?.(event,model);
    if (!supportsOpenAIWeb(model)) return;
    if (event?.type?.startsWith('response.web_search_call.') ||
        (event?.type==='response.output_item.added' && event.item?.type==='web_search_call')) status('Browsing the web…');
    if (event?.type==='response.output_item.done' && event.item?.type==='message') {
      for (const part of event.item.content || []) citeWebText(part);
      status(null);
    }
    if (['response.completed','response.done','response.failed','response.incomplete','error'].includes(event?.type)) status(null);
  };
}
