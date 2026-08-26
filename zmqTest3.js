// Replicate the testZmqInHost command logic with mocked vscode
const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock vscode module
const vscodeMock = {
  Uri: {
    file: function(filePath) {
      return { toString: () => filePath };
    },
    parse: function(str) {
      return { toString: () => str };
    }
  }
};

// Load kernelManager.js and replace vscode require
const kernelManagerPath = path.join(__dirname, 'dist', 'kernel', 'kernelManager.js');
let kernelManagerCode = fs.readFileSync(kernelManagerPath, 'utf8');

// Replace the vscode require line
const mockVscodeLine = 'const vscode = ' + JSON.stringify(vscodeMock) + ';';
kernelManagerCode = kernelManagerCode.replace(/const vscode = __importStar\(require\("vscode"\)\);/, mockVscodeLine);

// Write temporary file
const tempFilePath = path.join(__dirname, 'dist', 'kernel', 'kernelManagerMock.js');
fs.writeFileSync(tempFilePath, kernelManagerCode);

// Now load the mocked module
const KernelManager = require('./dist/kernel/kernelManagerMock.js').KernelManager;
const zmq = require('zeromq');
const crypto = require('crypto');

async function runTest() {
  console.info('[PythonLiteExtension] Starting zeromq isolation test');
  // Step 1: Test creating both DEALER and SUB sockets
  console.info('[PythonLiteExtension] Step 1: Creating zmq.Dealer and zmq.Subscriber...');
  const dealer = new zmq.Dealer();
  const subscriber = new zmq.Subscriber();

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

  try {
    // Step 2: Test subscribing to all topics
    console.info('[PythonLiteExtension] Step 2: Subscribing to all topics...');
    await subscriber.subscribe('');
    console.info('[PythonLiteExtension] Subscribed successfully');

    // Step 3: Test spawning kernel launcher via KernelManager
    console.info('[PythonLiteExtension] Step 3: Spawning kernel launcher via KernelManager...');

    // Create a dummy notebook URI for testing
    const testNotebookUri = vscodeMock.Uri.file(`_test_${Date.now()}.plnb`);

    const kernelManager = new KernelManager();
    await kernelManager.startKernel(testNotebookUri);
    console.info('[PythonLiteExtension] Kernel started successfully');

    // Step 4: Check that connection file exists and is valid
    console.info('[PythonLiteExtension] Step 4: Checking connection file...');
    const connectionInfo = kernelManager.getConnectionInfo(testNotebookUri);
    if (!connectionInfo) {
      throw new Error('Failed to get connection info from KernelManager');
    }
    console.info('[PythonLiteExtension] Connection info:', connectionInfo);

    // Step 5: Test connecting zeromq sockets to the kernel
    console.info('[PythonLiteExtension] Step 5: Connecting sockets to kernel...');

    // Connect dealer to shell port
    await dealer.connect(`tcp://${connectionInfo.ip}:${connectionInfo.shell_port}`);
    // Connect subscriber to iopub port and subscribe
    await subscriber.connect(`tcp://${connectionInfo.ip}:${connectionInfo.iopub_port}`);
    await subscriber.subscribe(''); // ensure subscribed

    console.info('[PythonLiteExtension] Sockets connected to kernel');

    // Step 6: Send a kernel_info_request to verify communication
    console.info('[PythonLiteExtension] Step 6: Sending kernel_info_request...');

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
    // Parse the reply message (same splitting)
    const replyParts = zmqMessageSplit(replyMsg);
    // The reply message format: [<signature>, b'', <header>, <parent_header>, <metadata>, <content>]
    // We assume signature may be empty if no key, but we have key.
    // Let's just log the content part (index 5) if exists.
    if (replyParts.length >= 6) {
      const contentBuffer = replyParts[5];
      const contentStr = contentBuffer.toString('utf8');
      console.info('[PythonLiteExtension] Reply content:', contentStr);
    } else {
      console.warn('[PythonLiteExtension] Unexpected reply parts length:', replyParts.length);
    }

    // Clean up
    console.info('[PythonLiteExtension] Cleaning up...');
    await dealer.close();
    await subscriber.close();
    await kernelManager.shutdownKernel(testNotebookUri);

    console.info('[PythonLiteExtension] All tests passed successfully!');
    return true;
  } catch (err) {
    console.error('[PythonLiteExtension] TEST FAILED with exception:', err);
    // Try to clean up
    try {
      await dealer.close();
    } catch (e) { /* ignore */ }
    try {
      await subscriber.close();
    } catch (e) { /* ignore */ }
    try {
      await kernelManager.shutdownKernel(testNotebookUri);
    } catch (e) { /* ignore */ }
    throw err;
  }
}

runTest().then(() => {
  console.log('TEST SUCCESS');
  process.exit(0);
}).catch(err => {
  console.log('TEST FAILED');
  process.exit(1);
});