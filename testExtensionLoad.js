// Test loading the extension module to see if there are any immediate errors
try {
    const extension = require('./dist/extension');
    console.log('Extension module loaded successfully');
    console.log('Export keys:', Object.keys(extension));

    if (extension.activate) {
        console.log('activate function exists');
        // Try calling activate with a mock context
        const mockContext = {
            subscriptions: [],
            extensionPath: __dirname,
            extensionUri: { fsPath: __dirname },
            globalState: { get: () => null, update: () => {}, keysFor: () => [] },
            workspaceState: { get: () => null, update: () => {}, keysFor: () => [] },
            extension: { id: '', uuid: '', path: __dirname, label: '', name: '', version: '', repository: null, extensionPath: __dirname, extensionUri: { fsPath: __dirname }, packageJSON: {} }
        };

        console.log('Calling activate function...');
        extension.activate(mockContext);
        console.log('Activate function called without error');
    } else {
        console.log('No activate function found');
    }
} catch (err) {
    console.error('Error loading or activating extension:');
    console.error(err);
    console.error(err.stack);
}