import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ConnectionInfo {
    shell_port: number;
    iopub_port: number;
    stdin_port: number;
    control_port: number;
    hb_port: number;
    key: string;
    signature_scheme: string;
    transport: string;
    ip: string;
}

export class KernelManager {
    private kernelProcesses: Map<string, ChildProcess> = new Map();
    private connectionFiles: Map<string, string> = new Map();

    /**
     * Start a kernel for the given notebook
     * @param notebookUri The URI of the notebook document
     * @returns Promise that resolves when the kernel is ready
     */
    public async startKernel(notebookUri: vscode.Uri): Promise<void> {
        // If kernel already exists for this notebook, do nothing
        if (this.kernelProcesses.has(notebookUri.toString())) {
            return;
        }

        const kernelId = Math.random().toString(36).substring(2, 15);
        const tempDir = path.join(os.tmpdir(), `python-lite-notebook-${kernelId}`);
        const connectionFilePath = path.join(tempDir, 'kernel.json');

        try {
            // Create temp directory
            fs.mkdirSync(tempDir, { recursive: true });

            // Resolve the kernel launcher script path
            const kernelScriptPath = path.join(__dirname, '..', '..', 'python', 'kernel_launcher.py');
            console.info(`[PythonLite Kernel Manager] Spawning kernel launcher:`);
            console.info(`  Command: python`);
            console.info(`  Script path: ${kernelScriptPath}`);
            console.info(`  Args: -f ${connectionFilePath}`);
            console.info(`  Full resolved script path exists: ${fs.existsSync(kernelScriptPath)}`);

            // Log the current working directory for debugging
            console.info(`[PythonLite Kernel Manager] Current working directory: ${process.cwd()}`);
            // Spawn the kernel launcher process, capturing stdout and stderr for diagnostics
            const kernelProcess = spawn('python', [
                kernelScriptPath,
                '-f',
                connectionFilePath
            ], {
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'] // ignore stdin, capture stdout & stderr
            });

            // Store the process and connection file path
            this.kernelProcesses.set(notebookUri.toString(), kernelProcess);
            this.connectionFiles.set(notebookUri.toString(), connectionFilePath);

            // Log subprocess output in real time
            kernelProcess.stdout.on('data', (data) => {
                console.info(`[PythonLite Kernel STDOUT] ${data.toString()}`);
            });
            kernelProcess.stderr.on('data', (data) => {
                console.error(`[PythonLite Kernel STDERR] ${data.toString()}`);
            });

            // Wait for the connection file to be created and valid
            await this.waitForConnectionFile(connectionFilePath, 30000); // 30 second timeout

            // Listen for process exit to clean up
            kernelProcess.on('exit', (code, signal) => {
                console.info(`Kernel process exited (code: ${code}, signal: ${signal})`);
                this.shutdownKernel(notebookUri);
            });

            kernelProcess.on('error', (err) => {
                console.error('Kernel process error:', err);
                this.shutdownKernel(notebookUri);
                vscode.window.showErrorMessage(`Failed to start Python kernel: ${err.message}`);
            });
        } catch (err) {
            console.error('Failed to start kernel:', err);
            // Clean up on failure
            this.shutdownKernel(notebookUri);
            throw err;
        }
    }

    /**
     * Wait for the connection file to be created and contain valid JSON
     * @param connectionFilePath Path to the connection file
     * @param timeoutMs Timeout in milliseconds
     */
    private waitForConnectionFile(connectionFilePath: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const checkInterval = 100; // Check every 100ms

            const check = () => {
                try {
                    if (fs.existsSync(connectionFilePath)) {
                        const content = fs.readFileSync(connectionFilePath, 'utf8');
                        const connectionInfo: ConnectionInfo = JSON.parse(content);

                        // Validate required fields
                        if (
                            connectionInfo.shell_port &&
                            connectionInfo.iopub_port &&
                            connectionInfo.stdin_port &&
                            connectionInfo.control_port &&
                            connectionInfo.hb_port &&
                            connectionInfo.key
                        ) {
                            resolve();
                            return;
                        }
                    }
                } catch (err) {
                    // File might be partially written or invalid JSON, keep trying
                }

                if (Date.now() - startTime > timeoutMs) {
                    reject(new Error(`Timeout waiting for kernel connection file: ${connectionFilePath}`));
                    return;
                }

                setTimeout(check, checkInterval);
            };

            check();
        });
    }

    /**
     * Get connection info for a notebook's kernel
     * @param notebookUri The URI of the notebook document
     * @returns Connection info or null if no kernel exists
     */
    public getConnectionInfo(notebookUri: vscode.Uri): ConnectionInfo | null {
        const connectionFilePath = this.connectionFiles.get(notebookUri.toString());
        if (!connectionFilePath) {
            return null;
        }

        try {
            if (fs.existsSync(connectionFilePath)) {
                const content = fs.readFileSync(connectionFilePath, 'utf8');
                return JSON.parse(content) as ConnectionInfo;
            }
        } catch (err) {
            console.error('Failed to read connection file:', err);
        }

        return null;
    }

    /**
     * Shutdown the kernel for a notebook
     * @param notebookUri The URI of the notebook document
     */
    public shutdownKernel(notebookUri: vscode.Uri): void {
        const kernelProcess = this.kernelProcesses.get(notebookUri.toString());
        if (kernelProcess) {
            kernelProcess.kill();
            this.kernelProcesses.delete(notebookUri.toString());
        }

        const connectionFilePath = this.connectionFiles.get(notebookUri.toString());
        if (connectionFilePath) {
            try {
                const tempDir = path.dirname(connectionFilePath);
                if (fs.existsSync(tempDir)) {
                    // Remove the temp directory and all its contents
                    fs.rmdirSync(tempDir, { recursive: true });
                }
            } catch (err) {
                console.error('Failed to clean up kernel temp directory:', err);
            }
            this.connectionFiles.delete(notebookUri.toString());
        }
    }

    /**
     * Restart the kernel for a notebook
     * @param notebookUri The URI of the notebook document
     */
    public async restartKernel(notebookUri: vscode.Uri): Promise<void> {
        this.shutdownKernel(notebookUri);
        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.startKernel(notebookUri);
    }

    /**
     * Shutdown all kernels
     */
    public shutdownAll(): void {
        for (const notebookUri of this.kernelProcesses.keys()) {
            this.shutdownKernel(vscode.Uri.parse(notebookUri));
        }
    }
}