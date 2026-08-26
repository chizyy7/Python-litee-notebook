import * as vscode from 'vscode';
import { PythonLiteExecutor } from './executor';
import { KernelManager } from './kernel/kernelManager';
import { KernelClient } from './kernel/kernelClient';
import { MessageMapper } from './kernel/messageMapper';
import { spawn } from 'child_process';

// Global instances (one per extension host)
const kernelManager = new KernelManager();
const kernelClients = new Map<string, KernelClient>();

export class PythonLiteController implements vscode.NotebookController {
    readonly id: string = 'python-lite-controller';
    readonly notebookType: string = 'python-lite-notebook';
    label: string = 'Python (subprocess)';
    readonly supportedLanguages: string[] = ['python'];
    private pythonExecutable: string | undefined;
    private executor: PythonLiteExecutor;
    private usePersistentKernel: boolean = false;
    private _onDidChangeSelectedNotebooks: vscode.EventEmitter<{
        notebook: vscode.NotebookDocument;
        selected: boolean;
    }> = new vscode.EventEmitter();

    constructor() {
        this.executor = new PythonLiteExecutor();
        // Set label based on whether we are using persistent kernel
        this.label = this.usePersistentKernel ? 'Python (persistent kernel)' : 'Python (subprocess)';
        this.checkPythonAvailability();
    }

    private async checkPythonAvailability(): Promise<void> {
        const pythonCandidates = ['python', 'python3'];
        for (const candidate of pythonCandidates) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const proc = spawn(candidate, ['--version'], { stdio: 'pipe' });
                    let output = '';
                    proc.stdout.on('data', (data) => { output += data.toString(); });
                    proc.stderr.on('data', (data) => { output += data.toString(); });
                    proc.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Exit code ${code}`));
                        }
                    });
                });

                this.pythonExecutable = candidate;
                vscode.window.showInformationMessage(`Python executable found: ${candidate}`);
                return;
            } catch (err) {
                // Try next candidate
                continue;
            }
        }

        this.pythonExecutable = undefined;
        vscode.window.showErrorMessage(
            'Python executable not found. Please install Python and ensure it is available in your PATH, or configure the Python interpreter path in settings.'
        );
    }

    // Kept for compatibility but not used when usePersistentKernel is forced false
    private async checkPersistentKernelAvailability(): Promise<void> {
        // Intentionally left empty; persistent kernel disabled.
        this.usePersistentKernel = false;
        this.label = 'Python (subprocess)';
    }

    getId(): string {
        return this.id;
    }

    getNotebookType(): string {
        return this.notebookType;
    }

    getSupportedLanguages(): string[] {
        return this.supportedLanguages;
    }

    /**
     * Get or create a kernel client for a notebook
     */
    private async getKernelClient(notebook: vscode.NotebookDocument): Promise<KernelClient> {
        const notebookKey = notebook.uri.toString();

        if (!kernelClients.has(notebookKey)) {
            console.info(`[PythonLiteController] Step 3: Spawning kernel launcher via KernelManager...`);
            // Start kernel if not already started
            await kernelManager.startKernel(notebook.uri);
            console.info(`[PythonLiteController] Kernel started successfully`);

            // Get connection info and create client
            console.info(`[PythonLiteController] Step 4: Checking connection file...`);
            const connectionInfo = kernelManager.getConnectionInfo(notebook.uri);
            if (!connectionInfo) {
                throw new Error('Failed to get kernel connection info');
            }
            console.info(`[PythonLiteController] Connection info:`, connectionInfo);

            const client = new KernelClient();
            console.info(`[PythonLiteController] Step 5: Initializing KernelClient (creating sockets)...`);
            await client.initialize(connectionInfo);
            console.info(`[PythonLiteController] KernelClient initialized successfully`);
            kernelClients.set(notebookKey, client);
        }

        const client = kernelClients.get(notebookKey);
        if (!client) {
            throw new Error('Failed to get or create kernel client');
        }
        return client;
    }

    /**
     * Handle notebook document closure to cleanup kernel client
     */
    public async onNotebookDocumentClosed(notebook: vscode.NotebookDocument): Promise<void> {
        // Only handle our notebook type
        if (notebook.notebookType !== this.notebookType) {
            return;
        }

        const notebookKey = notebook.uri.toString();
        const client = kernelClients.get(notebookKey);
        if (client) {
            try {
                await client!.dispose();
            } catch (err) {
                console.error(`[PythonLiteController] Error disposing kernel client for notebook ${notebookKey}:`, err);
            }
            kernelClients.delete(notebookKey);
        }
    }

    /**
     * Create a cell execution object
     */
    createNotebookCellExecution(cell: vscode.NotebookCell): vscode.NotebookCellExecution {
        // Return a new execution object - in practice, this is handled by the VS Code notebook infrastructure
        // when executeHandler is called, but we need to implement this method to satisfy the interface
        return {
            cell: cell,
            token: new vscode.CancellationTokenSource().token,
            executionOrder: undefined,
            start: (_startTime?: number) => { },
            end: (_success?: boolean | undefined, _endTime?: number) => { },
            clearOutput: (_cell?: vscode.NotebookCell) => Promise.resolve(),
            replaceOutput: (out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[], _cell?: vscode.NotebookCell) => Promise.resolve(),
            replaceOutputItems: (items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[], output: vscode.NotebookCellOutput) => Promise.resolve(),
            appendOutput: (out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[], _cell?: vscode.NotebookCell) => Promise.resolve(),
            appendOutputItems: (items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[], output: vscode.NotebookCellOutput) => Promise.resolve()
        };
    }

    /**
     * The execute handler is invoked when the run gestures in the UI are selected
     */
    executeHandler = async (cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController): Promise<void> => {
        // Decide whether to use persistent kernel or fallback to subprocess
        const useKernel = this.usePersistentKernel && this.pythonExecutable !== undefined;

        if (useKernel) {
            try {
                await this.executeCellsWithKernel(cells, notebook, controller);
            } catch (err) {
                console.error('Persistent kernel execution failed, falling back to subprocess:', err);
                vscode.window.showWarningMessage(
                    'Persistent kernel execution failed, falling back to subprocess execution'
                );
                // Fall back to subprocess for these cells
                await this.executeCellsWithSubprocess(cells, notebook, controller);
            }
        } else {
            await this.executeCellsWithSubprocess(cells, notebook, controller);
        }
    };

    private async executeCellsWithKernel(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): Promise<void> {
        const client = await this.getKernelClient(notebook);

        for (const cell of cells) {
            const execution = controller.createNotebookCellExecution(cell);
            execution.start(Date.now());

            try {
                const code = cell.document.getText();
                console.info(`[PythonLiteController] Executing code via persistent kernel: ${code.substring(0, 50)}...`);

                // Log before sending the request
                console.info(`[PythonLiteController] Step 6: Sending execute_request...`);
                const result = await client.executeRequest(code);
                console.info(`[PythonLiteController] Step 7: Received execute_reply`);

                // Convert Jupyter outputs to VS Code notebook output
                const notebookOutput = MessageMapper.jupyterOutputsToNotebookOutput(result.outputs);

                // Set the output and mark execution as complete
                execution.replaceOutput(notebookOutput).then(() => {
                    execution.end(true, Date.now());
                }, (err) => {
                    console.error('Failed to set notebook cell output:', err);
                    execution.end(true, Date.now());
                });
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error(`[PythonLiteController] Kernel execution failed for cell:`, err);
                const errorOutput = [vscode.NotebookCellOutputItem.error(new Error(`Failed to execute cell: ${errorMessage}`))];
                const cellOutput = new vscode.NotebookCellOutput(errorOutput);

                execution.replaceOutput(cellOutput).then(() => {
                    execution.end(false, Date.now());
                }, (err) => {
                    console.error('Failed to set notebook cell output:', err);
                    execution.end(false, Date.now());
                });
            }
        }
    }

    private async executeCellsWithSubprocess(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): Promise<void> {
        // Parameters intentionally used - keeping signature for interface compliance
        for (const cell of cells) {
            await this.executor.executeCell(cell, controller);
        }
    }

    /**
     * Optional interrupt handler.
     */
    interruptHandler = async (notebook: vscode.NotebookDocument): Promise<void> => {
        // TODO: Implement kernel interrupt if needed
        vscode.window.showWarningMessage('Interrupt not implemented for persistent kernel yet');
    };

    /**
     * An event that fires whenever a controller has been selected or un-selected for a notebook document.
     */
    get onDidChangeSelectedNotebooks(): vscode.Event<{
        notebook: vscode.NotebookDocument;
        selected: boolean;
    }> {
        return this._onDidChangeSelectedNotebooks.event;
    }

    /**
     * A controller can set affinities for specific notebook documents.
     */
    updateNotebookAffinity(notebook: vscode.NotebookDocument, affinity: vscode.NotebookControllerAffinity): void {
        // We don't need to set affinities for now
    }

    /**
     * Dispose and free associated resources.
     */
    dispose(): void {
        // Shutdown all kernels
        kernelManager.shutdownAll();

        // Dispose all kernel clients
        for (const client of kernelClients.values()) {
            client.dispose().catch(err => console.error('Error disposing kernel client:', err));
        }
        kernelClients.clear();

        // Dispose the event emitter
        this._onDidChangeSelectedNotebooks.dispose();
    }
}

export function createController(): PythonLiteController {
    return new PythonLiteController();
}