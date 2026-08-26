import * as vscode from 'vscode';
import * as zmq from 'zeromq';
import * as crypto from 'crypto';

export class KernelClient {
    private socketDealer: zmq.Dealer | null = null;
    private socketSubscriber: zmq.Subscriber | null = null;
    private connectionInfo: any = null;
    private key: string = '';
    private signature_scheme: string = 'hmac-sha256';

    /**
     * Initialize the client with connection information
     * @param connectionInfo The connection info from the kernel's connection file
     */
    public async initialize(connectionInfo: any): Promise<void> {
        this.connectionInfo = connectionInfo;
        this.key = connectionInfo.key;
        this.signature_scheme = connectionInfo.signature_scheme || 'hmac-sha256';

        // Create DEALER socket for shell communication
        this.socketDealer = new zmq.Dealer();
        await this.socketDealer.connect(
            `tcp://${connectionInfo.ip}:${connectionInfo.shell_port}`
        );

        // Create SUB socket for iopub communications
        this.socketSubscriber = new zmq.Subscriber();
        await this.socketSubscriber.connect(
            `tcp://${connectionInfo.ip}:${connectionInfo.iopub_port}`
        );
        await this.socketSubscriber.subscribe(''); // Subscribe to all topics
    }

    /**
     * Execute code in the kernel and return the results
     * @param code The Python code to execute
     * @returns Promise that resolves with execution results
     */
    public async executeRequest(code: string): Promise<{
        success: boolean;
        outputs: any[];
        execution_count: number | null;
    }> {
        if (!this.socketDealer || !this.socketSubscriber) {
            throw new Error('Kernel client not initialized');
        }

        const msgId = crypto.randomBytes(8).toString('hex');
        const session = crypto.randomBytes(8).toString('hex');
        const date = new Date().toISOString();

        console.info(`[PythonLite Kernel Client] Step 6: Sending execute_request`);
        console.info(`[PythonLite Kernel Client]   Message ID: ${msgId}`);
        console.info(`[PythonLite Kernel Client]   Code length: ${code.length} chars`);

        // Construct the execute_request message
        const content = {
            code: code,
            silent: false,
            store_history: true,
            user_expressions: {},
            allow_stdin: false
        };

        const header = {
            msg_id: msgId,
            username: '',
            session: session,
            date: date,
            msg_type: 'execute_request',
            version: '5.3'
        };

        const parent_header = {};
        const metadata = {};

        // Create the message buffers
        const headerBuffer = Buffer.from(JSON.stringify(header));
        const parentHeaderBuffer = Buffer.from(JSON.stringify(parent_header));
        const metadataBuffer = Buffer.from(JSON.stringify(metadata));
        const contentBuffer = Buffer.from(JSON.stringify(content));

        // Create the signature if key is provided
        let signature = Buffer.from('');
        if (this.key) {
            // The key in the connection file is a UUID string; convert to hex buffer
            const keyBuffer = Buffer.from(this.key.replace(/-/g, ''), 'hex');
            const hash = crypto.createHmac('sha256', keyBuffer);
            hash.update(headerBuffer);
            hash.update(parentHeaderBuffer);
            hash.update(metadataBuffer);
            hash.update(contentBuffer);
            signature = hash.digest();
            console.info(`[PythonLite Kernel Client] HMAC signature: key=${this.key}, signature=${signature.toString('hex')}`);
        }

        // Send the message in the Jupyter wire format:
        // [zeromq delimiter (empty), <IDS|MSG>, HMAC signature, header, parent_header, metadata, content]
        const messageParts = [
            Buffer.from(''), // zeromq delimiter (empty identity)
            Buffer.from('<IDS|MSG>'), // delimiter
            signature, // HMAC signature (empty if no key)
            headerBuffer,
            parentHeaderBuffer,
            metadataBuffer,
            contentBuffer
        ];

        // Send the execute_request message
        this.socketDealer.send(messageParts);
        console.info(`[PythonLite Kernel Client]   execute_request sent`);

        // Wait for the response
        console.info(`[PythonLite Kernel Client] Step 7: Waiting for execution result...`);
        const result = await this.waitForExecutionResult(msgId);
        console.info(`[PythonLite Kernel Client]   Execution completed with success: ${result.success}`);
        return result;
    }

    /**
     * Wait for the execution to complete and collect results
     * @param msgId The message ID of the execute_request
     * @returns Promise that resolves with execution results
     */
    private async waitForExecutionResult(msgId: string): Promise<{
        success: boolean;
        outputs: any[];
        execution_count: number | null;
    }> {
        return new Promise((resolve, reject) => {
            const outputs: any[] = [];
            let executionCount: number | null = null;
            let idleReceived = false;

            console.info(`[PythonLite Kernel Client]   Waiting for execute_reply (msg_id: ${msgId})`);

            // Set up a timeout to prevent hanging
            const timeoutId = setTimeout(() => {
                console.error(`[PythonLite Kernel Client]   Timeout waiting for execute_reply (msg_id: ${msgId})`);
                reject(new Error('Kernel execution timeout'));
            }, 30000); // 30 second timeout

            // Handle incoming messages
            (async () => {
                try {
                    for await (const [topic, msg] of this.socketSubscriber!) {
                        try {
                            // Parse the message (same format as we sent)
                            // Message format: [signatures..., delimiter, header, parent_header, metadata, content]
                            const msgParts = this.zmqMessageSplit(msg);

                            if (msgParts.length < 6) {
                                // Not enough parts, skip
                                continue;
                            }

                            // Skip any leading signature parts (we don't need to verify for now)
                            // Find the delimiter (empty buffer) that separates signatures from the actual message parts
                            let delimiterIndex = -1;
                            for (let i = 0; i < msgParts.length; i++) {
                                if (msgParts[i].length === 0) {
                                    delimiterIndex = i;
                                    break;
                                }
                            }

                            if (delimiterIndex === -1 || delimiterIndex + 5 >= msgParts.length) {
                                // Malformed message
                                continue;
                            }

                            // Extract the parts after the delimiter
                            const headerBuf = msgParts[delimiterIndex + 1];
                            const parentHeaderBuf = msgParts[delimiterIndex + 2];
                            const metadataBuf = msgParts[delimiterIndex + 3];
                            const contentBuf = msgParts[delimiterIndex + 4];

                            const header = JSON.parse(headerBuf.toString());
                            const parentHeader = JSON.parse(parentHeaderBuf.toString());
                            const metadata = JSON.parse(metadataBuf.toString());
                            const content = JSON.parse(contentBuf.toString());

                            // Only process messages related to our request
                            if (parentHeader.msg_id !== msgId) continue;

                            switch (header.msg_type) {
                                case 'stream':
                                    console.info(`[PythonLite Kernel Client]   Received stream output`);
                                    outputs.push({
                                        output_type: 'stream',
                                        name: content.name,
                                        text: Array.isArray(content.text) ? content.text.join('') : content.text
                                    });
                                    break;

                                case 'execute_result':
                                    console.info(`[PythonLite Kernel Client]   Received execute_result`);
                                    outputs.push({
                                        output_type: 'execute_result',
                                        data: content.data,
                                        execution_count: content.execution_count
                                    });
                                    executionCount = content.execution_count;
                                    break;

                                case 'error':
                                    console.info(`[PythonLite Kernel Client]   Received error output`);
                                    outputs.push({
                                        output_type: 'error',
                                        ename: content.ename,
                                        evalue: content.evalue,
                                        traceback: content.traceback
                                    });
                                    break;

                                case 'status':
                                    if (content.execution_state === 'idle') {
                                        console.info(`[PythonLite Kernel Client]   Received idle status`);
                                        idleReceived = true;
                                    }
                                    break;
                            }

                            // If we've received idle status, we're done
                            if (idleReceived) {
                                clearTimeout(timeoutId);

                                // Determine if execution was successful (no error outputs)
                                const hasError = outputs.some(output => output.output_type === 'error');
                                console.info(`[PythonLite Kernel Client]   Execution finished, success: ${!hasError}`);
                                resolve({
                                    success: !hasError,
                                    outputs: outputs,
                                    execution_count: executionCount
                                });
                                return; // Exit the loop
                            }
                        } catch (err) {
                            console.error('Error processing kernel message:', err);
                        }
                    }
                } catch (err) {
                    console.error('Error in message loop:', err);
                    reject(new Error('Error in message loop'));
                }
            })();
        });
    }

    // Helper function to split a zeromq message
    private zmqMessageSplit(msg: Uint8Array): Uint8Array[] {
        const parts: Uint8Array[] = [];
        let start = 0;
        for (let i = 0; i <= msg.length; i++) {
            if (i === msg.length || msg[i] === 0) {
                parts.push(msg.slice(start, i));
                start = i + 1;
            }
        }
        return parts;
    }

    /**
     * Shutdown the client and close sockets
     */
    public async dispose(): Promise<void> {
        if (this.socketDealer) {
            await this.socketDealer.close();
            this.socketDealer = null;
        }
        if (this.socketSubscriber) {
            await this.socketSubscriber.close();
            this.socketSubscriber = null;
        }
    }
}