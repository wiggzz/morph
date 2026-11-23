import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../../mobile/package.json',import.meta.url));
test('cold Metro development builds can read LogBox PNG dimensions with image-size v2',async()=>{
  const metro=path.dirname(require.resolve('metro/package.json'));
  const {getAssetData}=require(path.join(metro,'src/Assets.js'));
  const rn=path.dirname(require.resolve('react-native/package.json'));
  const asset=path.join(rn,'Libraries/LogBox/UI/LogBoxImages/chevron-left.png');
  const data=await getAssetData(asset,'node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/chevron-left.png',[],'android','/assets');
  assert.ok(data.width>0);assert.ok(data.height>0);assert.equal(data.type,'png');
});
