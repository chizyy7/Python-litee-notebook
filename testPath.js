const path = require('path');
const fs = require('fs');
// Simulate __dirname of the compiled kernelManager.js file: dist/kernel
const __dirname = path.join(__dirname, 'dist', 'kernel');
console.log('__dirname:', __dirname);
const kernelScriptPath = path.join(__dirname, '..', '..', 'python', 'kernel_launcher.py');
console.log('Resolved path:', kernelScriptPath);
console.log('File exists:', fs.existsSync(kernelScriptPath));