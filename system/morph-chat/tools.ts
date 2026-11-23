import {Type} from 'typebox';
import {storage} from '@morph/agent';

// Standard Pi tool definitions. Only execution lives in Morph's sandbox.
export default function registerTools(pi) {
  pi.registerTool({
    name:'chat_note',
    label:'Save chat note',
    description:'Save a useful note to the chat UI workspace and show a note card in the conversation.',
    parameters:Type.Object({note:Type.String({maxLength:2000})}),
    async execute(_toolCallId,{note},signal,onUpdate) {
      signal.throwIfAborted();
      onUpdate?.({content:[{type:'text',text:'Saving note…'}],details:{pending:true}});
      await storage.set('latest-note',{note,savedAt:Date.now()});
      signal.throwIfAborted();
      return {content:[{type:'text',text:'Saved note.'}],details:{note}};
    },
  });
}
