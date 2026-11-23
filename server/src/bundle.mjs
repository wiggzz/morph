import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtime = fileURLToPath(new URL('../../runtime/', import.meta.url));
const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '.json', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

export async function bundle(snapshot) {
  const result = await build({
    entryPoints: [path.join(runtime, 'entry.jsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2020', minify: true,
    define: { 'process.env.NODE_ENV': '"production"', '__MORPH_CHAT__': JSON.stringify(snapshot.chatUI===true && snapshot.appID==='morph-chat') },
    logLevel: 'silent',
    plugins: [{ name: 'virtual-files', setup(b) {
      b.onResolve({filter:/^virtual:(App|Tools)$/},args=>{
        if(args.namespace!=='file'||args.importer!==path.join(runtime,'entry.jsx'))throw new Error('Internal entry imports are not available to project/package code');
        if(args.path==='virtual:App')return {path:'/App.tsx',namespace:'vfs'};
        const toolsFile=['/tools.ts','/tools.js'].find(file=>Object.hasOwn(snapshot.files,file));
        return snapshot.chatUI && snapshot.appID==='morph-chat' && toolsFile?{path:toolsFile,namespace:'vfs'}:{path:'empty-tools',namespace:'empty-tools'};
      });
      b.onLoad({filter:/.*/,namespace:'empty-tools'},()=>({contents:'export default () => {};',loader:'js'}));
      const resolve = args => {
        if (args.path === 'typebox') return {path:require.resolve('typebox')};
        if (args.path === 'react' || args.path === 'react/jsx-runtime') return { path: require.resolve(args.path) };
        if (args.path === 'react-native' || args.path === '@morph/ui') return { path: path.join(runtime, 'native-shim.js') };
        if (args.path === '@morph/chat') {
          if (snapshot.appID !== 'morph-chat' || snapshot.chatUI !== true || args.namespace !== 'vfs') throw new Error('@morph/chat is reserved for the system chat project');
          return { path: path.join(runtime, 'chat-client.js') };
        }
        if (args.path === '@morph/plugins') return { path: path.join(runtime, 'plugin-client.js') };
        if (args.path === '@morph/agent') return { path: path.join(runtime, 'agent-client.js') };
        if (args.path.startsWith('@plugins/')) {
          const id = args.path.slice('@plugins/'.length);
          const dependency = snapshot.dependencies?.[id];
          if (!dependency) throw new Error('Plugin is not installed/approved in this snapshot: ' + id);
          const entry = dependency.files['/index.ts'] ? '/index.ts' : '/index.js';
          return { path: entry, namespace: 'plugin:' + id };
        }
        if (!args.path.startsWith('.') && !args.path.startsWith('/')) throw new Error('Import not allowed: ' + args.path);
        const files = args.namespace === 'vfs' ? snapshot.files : snapshot.dependencies[args.namespace.slice(7)].files;
        const resolved = path.posix.resolve(path.posix.dirname(args.importer), args.path);
        const found = extensions.map(ext => resolved + ext).find(p => Object.hasOwn(files, p));
        if (!found) throw new Error('Virtual module not found: ' + args.path);
        return { path: found, namespace: args.namespace };
      };
      const load = args => ({
        contents: (args.namespace === 'vfs' ? snapshot.files : snapshot.dependencies[args.namespace.slice(7)].files)[args.path],
        loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'jsx',
      });
      for (const namespace of ['vfs', ...Object.keys(snapshot.dependencies || {}).map(id => 'plugin:' + id)]) {
        b.onResolve({ filter: /.*/, namespace }, resolve);
        b.onLoad({ filter: /.*/, namespace }, load);
      }
      b.onResolve({ filter: /^(react|react-reconciler)$/ }, args => ({ path: require.resolve(args.path) }));
    } }],
  });
  return result.outputFiles[0].text;
}

export function html(code) {
  return `<!doctype html><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
}
