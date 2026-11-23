import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChatMarkdown,chatLink} from '../../mobile/src/chatMarkdownParser.js';
const flatten=nodes=>nodes.flatMap(n=>[n,...flatten(n.children||[])]);
test('chat Markdown parses headings, emphasis, strike, inline code and line breaks',()=>{
  const nodes=flatten(parseChatMarkdown('# Title\n\n**bold** *italic* ~~gone~~ `code`\nnext line'));
  for(const type of ['heading','strong','em','s','code_inline','softbreak'])assert.ok(nodes.some(n=>n.type===type),type);
  assert.equal(nodes.find(n=>n.type==='heading').tag,'h1');assert.equal(nodes.find(n=>n.type==='code_inline').content,'code');
});
test('Markdown supports nested lists, ordered starts, quotes, fences, rules and tables',()=>{
  const nodes=flatten(parseChatMarkdown('3. First\n4. Second\n   - Nested\n\n> Quote\n\n```js\nconst x = 1;\n```\n\n---\n\n| A | B |\n|---|---:|\n| one | two |'));
  for(const type of ['ordered_list','bullet_list','blockquote','fence','hr','table','th','td'])assert.ok(nodes.some(n=>n.type===type),type);
  assert.equal(nodes.find(n=>n.type==='ordered_list').attrs.start,3);assert.equal(nodes.find(n=>n.type==='fence').content,'const x = 1;\n');assert.equal(nodes.find(n=>n.type==='fence').info,'js');
});
test('ordinary/reference/autolinks work, but only explicit web URLs are launchable',()=>{
  const nodes=flatten(parseChatMarkdown('[Example](https://example.com/path) [docs][ref] https://example.org\n\n[ref]: https://docs.example.com'));
  assert.equal(nodes.filter(n=>n.type==='link').length,3);assert.equal(chatLink('https://example.com/path?q=1#part'),'https://example.com/path?q=1#part');assert.equal(chatLink('http://example.com'),'http://example.com');
  for(const link of ['javascript:alert(1)','file:///private','data:text/html,test','intent://anything','exp://localhost','mailto:a@example.com','//example.com','https://user:secret@example.com','https://example.com\\@evil','https://example.com\n','https://'])assert.equal(chatLink(link),null,link);
});
test('HTML remains literal and unsafe Markdown links never become actionable',()=>{
  const nodes=flatten(parseChatMarkdown('<script>alert(1)</script>\n\n[bypass](javascript:alert(1))\n\n<img src="https://example.com/tracker">'));
  assert.equal(nodes.some(n=>n.type.startsWith('html')),false);assert.equal(nodes.some(n=>n.type==='link'&&/^javascript:/i.test(n.attrs.href)),false);assert.equal(nodes.some(n=>n.type==='image'),false);assert.ok(nodes.some(n=>n.type==='text'&&n.content.includes('<script>')));
  const image=flatten(parseChatMarkdown('![alt](https://example.com/image.png)')).find(n=>n.type==='image');assert.equal(image.content,'alt');
});
test('large or extremely complex messages preserve their full text with a bounded plain fallback',()=>{
  for(const text of ['x'.repeat(64001),'**a** '.repeat(2000)]){const nodes=flatten(parseChatMarkdown(text));assert.equal(nodes.filter(n=>n.type==='text').map(n=>n.content).join(''),text);assert.ok(nodes.length<5);}
  assert.deepEqual(parseChatMarkdown(null),[]);
});
