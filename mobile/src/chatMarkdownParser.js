import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt({html:false,linkify:true,breaks:true,maxNesting:20});
const plain = text => [{type:'paragraph',children:[{type:'inline',children:[{type:'text',content:text,children:[]}]}]}];

// Only user-tapped web links can leave chat. No intents, file/data/javascript
// URLs or remote image fetching in the protected host.
export function chatLink(value) {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  const match = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);
  return match && !match[1].includes('@') ? value : null;
}

export function parseChatMarkdown(value) {
  const text = typeof value === 'string' ? value : '';
  // Preserve all text; exceptionally large/complex messages fall back to plain
  // selectable text rather than creating thousands of native views.
  if (text.length > 64000) return plain(text);
  try {
    let count = 0;
    const tree = tokens => {
      const root = {children:[]}, stack = [root];
      for (const token of tokens) {
        if (++count > 4000) throw new Error('Markdown node limit');
        if (token.nesting === -1) {if (stack.length > 1) stack.pop();continue;}
        const node = {type:token.type.replace(/_open$/,''),tag:token.tag,content:token.content,info:token.info,hidden:token.hidden,attrs:Object.fromEntries(token.attrs || []),children:token.children ? tree(token.children) : []};
        stack[stack.length-1].children.push(node);
        if (token.nesting === 1) stack.push(node);
      }
      return root.children;
    };
    return tree(parser.parse(text,{}));
  } catch {return plain(text);}
}
