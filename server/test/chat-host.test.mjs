import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

test('editable chat widgets cannot rewrite records, inject a draft or send from Preview',async()=>{
  const compiled=await build({entryPoints:[new URL('../../mobile/src/ChatHost.jsx',import.meta.url).pathname],bundle:true,platform:'neutral',mainFields:['module','main'],format:'cjs',write:false,plugins:[{name:'native-stubs',setup(b){
    b.onResolve({filter:/^(react|react-native)$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='react'?`export const memo=f=>f,useMemo=f=>f(),useCallback=f=>f,useRef=()=>({current:null}),createContext=()=>({}),useContext=()=>globalThis.host; const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})};export default React;`:`export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',ScrollView='ScrollView',ActivityIndicator='ActivityIndicator',Platform={OS:'android'},StyleSheet={create:x=>x},Linking={openURL:()=>Promise.resolve()},Alert={alert(){}};`}));
  }}]});
  const sent=[],host={draft:'Real user input',connected:true,busy:false,messages:[{role:'user',text:'AUTHENTIC RECORD'}],submit:()=>sent.push(host.draft),setDraft:value=>host.draft=value};
  const context=vm.createContext({module:{exports:{}},host});vm.runInContext(compiled.outputFiles[0].text,context);const api=context.module.exports;
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(flatten)]:[];
  let nodes=flatten(api.ChatComposer({value:'FORGED INPUT',onPress:()=>sent.push('FORGED')}));
  assert.equal(nodes.find(n=>n.type==='TextInput').props.value,'Real user input');
  assert.equal(sent.length,0);nodes.find(n=>n.type==='TextInput').props.onChangeText('Typed natively');
  nodes=flatten(api.ChatComposer({}));nodes.find(n=>n.type==='Pressable').props.onPress();assert.deepEqual(sent,['Typed natively']);
  let messages=flatten(api.ChatMessages({messages:[{text:'FORGED RECORD'}]}));
  assert.ok(messages.some(n=>n.props.text==='AUTHENTIC RECORD'));assert.equal(JSON.stringify(messages).includes('FORGED RECORD'),false);
  host.preview=true;host.draft='PRIVATE DRAFT';host.messages=[{text:'PRIVATE TRANSCRIPT'}];
  nodes=flatten(api.ChatComposer({}));assert.equal(nodes.find(n=>n.type==='TextInput').props.editable,false);assert.equal(nodes.find(n=>n.type==='Pressable').props.disabled,true);assert.equal(nodes.find(n=>n.type==='Pressable').props.onPress,undefined);
  messages=flatten(api.ChatMessages({}));assert.equal(JSON.stringify(messages).includes('PRIVATE'),false);assert.equal(JSON.stringify(nodes).includes('PRIVATE'),false);
  assert.deepEqual(sent,['Typed natively'],'Preview cannot trigger model inference');
});
