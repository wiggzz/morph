// Metro 0.83 passes file paths to image-size; the security-patched v2 API
// accepts bytes only. Keep the patched dependency and adapt Metro's call site.
const fs = require('node:fs');
const path = require('node:path');
const filename = path.join(path.dirname(require.resolve('metro/package.json')), 'src/Assets.js');
const original = 'const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;';
const replacement = 'const dimensions = isImage ? (0, _imageSize.default)(typeof isImageInput === "string" ? _fs.default.readFileSync(isImageInput) : isImageInput) : null;';
const source = fs.readFileSync(filename, 'utf8');
if (source.includes(replacement)) process.exit(0);
if (source.split(original).length !== 2) throw new Error('Metro asset API changed; review the image-size v2 adaptation before continuing.');
fs.writeFileSync(filename, source.replace(original, replacement));
console.log('Adapted Metro assets to the image-size v2 byte-input API.');
