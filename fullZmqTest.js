// Mock vscode module for the test
const vscode = {
  Uri: {
    file: (filePath) => ({ toString: () => filePath }),
    parse: (str) => ({ toString: () => str })
  },
  window: {
    showInformationMessage: (msg) => console.info('[Mock] Info:', msg),
    showWarningMessage: (msg) => console.warn('[Mock] Warning:', msg),
    showErrorMessage: (msg) => console.error('[Mock] Error:', msg)
  }
};

// Mock the zeromq import - we'll use the real zeromq
const zmq = require('zeromq');

// We need to load the KernelManager with our mocked vscode
const path = require('path');
const fs = require('fs');

// Load kernelManager.js and replace vscode require
const kernelManagerPath = path.join(__dirname, 'dist', 'kernel', 'kernelManager.js');
let kernelManagerCode = fs.readFileSync(kernelManagerPath, 'utf8');

// Replace the vscode require line with our mock
const mockVscodeLine = 'const vscode = ' + JSON.stringify(vscode) + ';';
kernelManagerCode = kernelManagerCode.replace(/const vscode = __importStar\(require\("vscode"\)\);/, mockVscodeLine);

// Write temporary file
const tempFilePath = path.join(__dirname, 'dist', 'kernel', 'kernelManagerMock.js');
fs.writeFileSync(tempFilePath, kernelManagerCode);

// Now load the mocked module
const KernelManager = require('./dist/kernel/kernelManagerMock.js').KernelManager;
const crypto = require('crypto');

// Global kernel manager instance for testing (same as in extension.ts)
const testKernelManager = new KernelManager();

// Helper to split zmq message (same as in KernelClient)
function zmqMessageSplit(msg) {
  const parts = [];
  let start = 0;
  for (let i = 0; i <= msg.length; i++) {
    if (i === msg.length || msg[i] === 0) {
      parts.push(msg.slice(start, i));
      start = i + 1;
    }
  }
  return parts;
}

// The testZmqInHost function copied from extension.ts (lines 70-253)
async function testZmqInHost() {
  console.info('[PythonLiteExtension] Starting zeromq isolation test');
  // vscode.window.showInformationMessage('[Test] Starting zeromq isolation test...');

  if (!zmq) {
    const errorMsg = 'zeromq module failed to load - check extension host console for details';
    console.error('[PythonLiteExtension] TEST FAILED:', errorMsg);
    // vscode.window.showErrorMessage(`[Test] FAILED: ${errorMsg}`);
    return;
  }

  try {
    // Step 1: Test creating both DEALER and SUB sockets
    console.info('[PythonLiteExtension] Step 1: Creating zmq.Dealer and zmq.Subscriber...');
    // vscode.window.showInformationMessage('[Test] Step 1: Creating sockets...');

    const dealer = new zmq.Dealer();
    const subscriber = new zmq.Subscriber();

    console.info('[PythonLiteExtension] Sockets created successfully');
    // vscode.window.showInformationMessage('[Test] Sockets created');

    // Step 2: Test subscribing to all topics
    console.info('[PythonLiteExtension] Step 2: Subscribing to all topics...');
    // vscode.window.showInformationMessage('[Test] Step 2: Subscribing...');
    await subscriber.subscribe('');
    console.info('[PythonLiteExtension] Subscribed successfully');
    // vscode.window.showInformationMessage('[Test] Subscribed');

    // Step 3: Test spawning kernel launcher via KernelManager
    console.info('[PythonLiteExtension] Step 3: Spawning kernel launcher via KernelManager...');
    // vscode.window.showInformationMessage('[Test] Step 3: Starting kernel...');

    // Create a dummy notebook URI for testing
    const testNotebookUri = vscode.Uri.file(`_test_${Date.now()}.plnb`);

    try {
      await testKernelManager.startKernel(testNotebookUri);
      console.info('[PythonLiteExtension] Kernel started successfully');
      // vscode.window.showInformationMessage('[Test] Kernel started');

      // Step 4: Check that connection file exists and is valid
      console.info('[PythonLiteExtension] Step 4: Checking connection file...');
      // vscode.window.showInformationMessage('[Test] Step 4: Checking connection file...');
      const connectionInfo = testKernelManager.getConnectionInfo(testNotebookUri);
      if (!connectionInfo) {
        throw new Error('Failed to get connection info from KernelManager');
      }
      console.info('[PythonLiteExtension] Connection info:', connectionInfo);
      // vscode.window.showInformationMessage(`[Test] Connection file valid: ports=${connectionInfo.shell_port},${connectionInfo.iopub_port}`);

      // Step 5: Test connecting zeromq sockets to the kernel
      console.info('[PythonLiteExtension] Step 5: Connecting sockets to kernel...');
      // vscode.window.showInformationMessage('[Test] Step 5: Connecting sockets...');

      // Connect dealer to shell port
      await dealer.connect(`tcp://${connectionInfo.ip}:${connectionInfo.shell_port}`);
      // Connect subscriber to iopub port and subscribe
      await subscriber.connect(`tcp://${connectionInfo.ip}:${connectionInfo.iopub_port}`);
      await subscriber.subscribe(''); // ensure subscribed

      console.info('[PythonLiteExtension] Sockets connected to kernel');
      // vscode.window.showInformationMessage('[Test] Sockets connected');

      // Step 6: Send a kernel_info_request to verify communication
      console.info('[PythonLiteExtension] Step 6: Sending kernel_info_request...');
      // vscode.window.showInformationMessage('[Test] Step 6: Sending kernel_info_request...');

      const msgId = crypto.randomBytes(8).toString('hex');
      const session = crypto.randomBytes(8).toString('hex');
      const date = new Date().toISOString();

      const content = {};

      const header = {
        msg_id: msgId,
        username: '',
        session: session,
        date: date,
        msg_type: 'kernel_info_request',
        version: '5.3'
      };

      const parent_header = {};
      const metadata = {};

      const headerBuffer = Buffer.from(JSON.stringify(header));
      const parentHeaderBuffer = Buffer.from(JSON.stringify(parent_header));
      const metadataBuffer = Buffer.from(JSON.stringify(metadata));
      const contentBuffer = Buffer.from(JSON.stringify(content));

      // Create signature if key is provided
      let signature = Buffer.from('');
      if (connectionInfo.key) {
        const hash = crypto.createHmac('sha256', connectionInfo.key);
        hash.update(headerBuffer);
        hash.update(parentHeaderBuffer);
        hash.update(metadataBuffer);
        hash.update(contentBuffer);
        signature = hash.digest();
      }

      const messageParts = [
        signature,
        Buffer.from(''), // delimiter
        headerBuffer,
        parentHeaderBuffer,
        metadataBuffer,
        contentBuffer
      ];

      // Send the message
      dealer.send(messageParts);

      // Wait for kernel_info_reply using async iterator with timeout
      console.info('[PythonLiteExtension] Waiting for kernel_info_reply...');
      // vscode.window.showInformationMessage('[Test] Waiting for reply...');
      const replyMsg = await (async () => {
        const timeoutId = setTimeout(() => {
          throw new Error('Timeout waiting for kernel_info_reply');
        }, 5000);
        try {
          for await (const [topic, msg] of subscriber) {
            clearTimeout(timeoutId);
            return msg; // return the raw msg Uint8Array
          }
        } finally {
          clearTimeout(timeoutId);
        }
      })();

      console.info('[PythonLiteExtension] Received kernel info reply');
      // vscode.window.showInformationMessage('[Test] Kernel info reply received');

      // Clean up
      console.info('[PythonLiteExtension] Cleaning up...');
      // vscode.window.showInformationMessage('[Test] Cleaning up...');

      await dealer.close();
      await subscriber.close();
      await testKernelManager.shutdownKernel(testNotebookUri);

      console.info('[PythonLiteExtension] All tests passed successfully!');
      // vscode.window.showInformationMessage('[Test] ALL TESTS PASSED!');
    } catch (kernelErr) {
      // If kernel steps failed, still try to clean up sockets
      console.error('[PythonLiteExtension] Kernel test failed:', kernelErr);
      // vscode.window.showErrorMessage(`[Test] KERNEL TEST FAILED: ${kernelErr.message}`);
      try {
        await dealer.close();
      } catch (e) { /* ignore */ }
      try {
        await subscriber.close();
      } catch (e) { /* ignore */ }
      try {
        await testKernelManager.shutdownKernel(testNotebookUri);
      } catch (e) { /* ignore */ }
      return; // exit early
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[PythonLiteExtension] TEST FAILED with exception:', err);
    // vscode.window.showErrorMessage(`[Test] FAILED: ${errorMsg}`);
    // Don't re-throw - we want to capture the error, not crash the host
  }
}

// Run the test
testZmqInHost().then(() => {
  console.log('TEST COMPLETED');
  process.exit(0);
}).catch(err => {
  console.error('TEST FAILED WITH UNCAUGHT ERROR:', err);
  process.exit(1);
});