import fs from 'node:fs';
export const CHAT_APP_ID = 'morph-chat';
export function installSystemChat(library) {
  if (library.state.apps.some(a=>a.id===CHAT_APP_ID)) throw new Error('Reserved system chat ID collides with an existing app; no files have been overwritten');
  library.state.systemApps ||= [];
  if (library.state.systemApps.some(a=>a.id===CHAT_APP_ID)) return;
  library.state.systemApps.push({id:CHAT_APP_ID,name:'Chat UI',icon:'◌',system:'chat',services:null});
  const w=library.workspace(CHAT_APP_ID);
  w.write('/App.tsx',fs.readFileSync(new URL('../../system/morph-chat/App.tsx',import.meta.url),'utf8'));
  w.write('/tools.ts',fs.readFileSync(new URL('../../system/morph-chat/tools.ts',import.meta.url),'utf8'));
  w.promote({...w.snapshot(),appID:CHAT_APP_ID,chatUI:true},'Bundled chat UI');
  library.save();
}
