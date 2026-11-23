import {useSyncExternalStore} from 'react';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
let state=freeze({title:'Chat preview',busy:false,connected:false,messageCount:0,mode:'preview',messages:[],event:null,truncated:false});
const listeners=new Set();
window.__morphSetChatState = value => {
  if (!value || typeof value!=='object') return;
  const next={title:String(value.title||'Chat').slice(0,80),busy:value.busy===true,connected:value.connected===true,messageCount:Math.max(0,Math.min(100000,Number(value.messageCount)||0)),mode:['docked','full','preview'].includes(value.mode)?value.mode:'preview',messages:Array.isArray(value.messages)?JSON.parse(JSON.stringify(value.messages)):[],event:value.event?JSON.parse(JSON.stringify(value.event)):null,truncated:value.truncated===true};
  if(JSON.stringify(next)===JSON.stringify(state))return;
  state=freeze(next);for(const listener of listeners)listener();
};
export const getChatSnapshot=()=>state;
export const useChat=()=>useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},getChatSnapshot,getChatSnapshot);
// Optional native defaults. Custom components can render the read-only Pi message projection instead.
export const ChatMessages='ChatMessages';
export const ChatComposer='ChatComposer';
export const ChatStatus='ChatStatus';
export const Markdown='ChatMarkdown';
export const ChatScrollView='ChatScrollView';
