import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distSrc = path.resolve(__dirname, '..', 'dist', 'src');

if (!fs.existsSync(distSrc)) {
  fs.mkdirSync(distSrc, { recursive: true });
}

fs.writeFileSync(path.join(distSrc, 'main.js'), "import '../main.js';\n");
console.log('Postbuild: successfully created dist/src/main.js proxy.');
