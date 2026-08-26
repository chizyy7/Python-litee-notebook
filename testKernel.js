// Mock vscode module
const vscode = {
  Uri: {
    parse: function(str) {
      return { toString: () => str };
    }
  }
};

// We need to intercept the require for vscode in the kernelManager.js
// Since we are going to load the compiled kernelManager.js, we can use a proxy or rewrite the require.
// Instead, let's modify the kernelManager.js to use our mock if a global flag is set.
// But that's invasive.

// Alternatively, we can use the source and use ts-node with a mock.
// Let's try to use the compiled version and use module aliasing.

// We'll create a temporary file that replaces the vscode require with our mock.

const fs = require('fs');
const path = require('path');

// Read the compiled kernelManager.js
const kernelManagerPath = path.join(__dirname, 'dist', 'kernel', 'kernelManager.js');
let kernelManagerCode = fs.readFileSync(kernelManagerPath, 'utf8');

// Replace the vscode require with our mock
// The line looks like: const vscode = __importStar(require("vscode"));
// We'll replace it with: const vscode = { Uri: { parse: function(str) { return { toString: () => str }; } } };
const mockVscodeLine = 'const vscode = { Uri: { parse: function(str) { return { toString: () => str }; } } };';
kernelManagerCode = kernelManagerCode.replace(/const vscode = __importStar\(require\("vscode"\)\);/, mockVscodeLine);

// Write to a temporary file
const tempFilePath = path.join(__dirname, 'dist', 'kernel', 'kernelManagerMock.js');
fs.writeFileSync(tempFilePath, kernelManagerCode);

// Now load the mocked module
const KernelManager = require('./dist/kernel/kernelManagerMock').KernelManager;

// Test
(async () => {
  const km = new KernelManager();
  try {
    await km.startKernel(vscode.Uri.parse('file:///dummy.plnb'));
    console.log('Kernel started successfully');
  } catch (err) {
    console.error('Failed to start kernel:', err);
  }
})();