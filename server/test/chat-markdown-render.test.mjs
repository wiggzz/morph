import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

// Structural renderer test with native host-component stubs, not device pixels.
test('chat Markdown renders native selectable blocks/styles and only opens tapped web links',async()=>{
  const compiled=await build({entryPoints:[new URL('../../mobile/src/ChatMarkdown.jsx',import.meta.url).pathname],bundle:true,platform:'neutral',mainFields:['module','main'],format:'cjs',write:false,plugins:[{name:'native-stubs',setup(b){
    b.onResolve({filter:/^(react|react-native)$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='react'?`export const memo=f=>f;export const useMemo=f=>f();const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})};export default React;`:`export const View='View',Text='Text',ScrollView='ScrollView',Platform={OS:'android'},StyleSheet={create:x=>x},Linking={openURL:url=>{globalThis.opened.push(url);return Promise.resolve();}},Alert={alert:()=>{}};`}));
  }}]});
  const context=vm.createContext({module:{exports:{}},opened:[]});vm.runInContext(compiled.outputFiles[0].text,context);
  const render=context.module.exports.ChatMarkdown;
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(flatten)]:[];
  const tree=render({text:'# Heading\n\n**Bold** and *italic* with `code` [site](https://example.com).\n\n- One\n- Two\n\n> Quote\n\n```js\nconst x=1;\n```\n\n| A | B |\n|---|---|\n| C | D |\n\n![alt](https://example.com/image.png)'}),nodes=flatten(tree);
  assert.ok(nodes.some(n=>n.type==='Text'&&n.props.accessibilityRole==='header'&&n.props.selectable));
  assert.ok(nodes.some(n=>n.type==='Text'&&n.props.style?.fontWeight==='700'));
  assert.ok(nodes.some(n=>n.type==='Text'&&n.props.style?.fontStyle==='italic'));
  assert.ok(nodes.filter(n=>n.type==='ScrollView'&&n.props.horizontal).length>=2,'code and tables scroll horizontally');
  assert.equal(nodes.some(n=>n.type==='Image'||n.type==='WebView'),false);assert.equal(context.opened.length,0,'render never fetches images or opens links');
  const link=nodes.find(n=>n.props.accessibilityRole==='link');link.props.onPress();assert.deepEqual([...context.opened],['https://example.com']);
  const unsafe=flatten(render({text:'[bad](javascript:alert(1)) [file](file:///private) [intent](intent://anything)'}));assert.equal(unsafe.some(n=>n.props.onPress),false);
});
