import * as vscode from 'vscode';
import { spawn } from 'child_process';

export class PythonLiteExecutor {
    private pythonExecutable: string | undefined;

    constructor() {
        this.checkPythonAvailability();
    }

    private async checkPythonAvailability(): Promise<void> {
        const pythonCandidates = ['python', 'python3'];
        for (const candidate of pythonCandidates) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const proc = spawn(candidate, ['--version'], { stdio: 'pipe' });
                    let output = '';
                    proc.stdout.on('data', (data) => { output += data; });
                    proc.stderr.on('data', (data) => { output += data; });
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
                console.info(`[PythonLiteExecutor] Python executable found: ${candidate}`);
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

    private dedent(code: string): string {
        const lines = code.split('\n');
        // Find the minimum indentation (excluding empty lines)
        let minIndent = Infinity;
        for (const line of lines) {
            const trimmed = line.trimStart();
            if (trimmed === '') {
                continue;
            }
            const indent = line.length - trimmed.length;
            if (indent < minIndent) {
                minIndent = indent;
            }
        }
        if (minIndent === Infinity) {
            // No non-empty lines
            return code;
        }
        // Remove minIndent from each line
        return lines.map(line => line.slice(minIndent)).join('\n');
    }

    async executeCell(cell: vscode.NotebookCell, controller: vscode.NotebookController): Promise<void> {
        if (!this.pythonExecutable) {
            vscode.window.showErrorMessage('Python executable not available. Cannot execute cells.');
            return;
        }

        const execution = controller.createNotebookCellExecution(cell);
        execution.start(Date.now());

        try {
            const rawCode = cell.document.getText();
            console.info(`[PythonLiteExecutor] Raw code (JSON): ${JSON.stringify(rawCode)}`);
            const code = this.dedent(rawCode);
            console.info(`[PythonLiteExecutor] Dedented code (JSON): ${JSON.stringify(code)}`);

            // Preamble to set matplotlib backend to Agg and import necessary modules
            const preamble = `
import os
os.environ['MPLBACKEND'] = 'Agg'
import matplotlib
matplotlib.use('Agg')
`;
            // Postamble to capture matplotlib figures and output them as base64 PNGs
            const postamble = `
import io
import base64
import json
try:
    import matplotlib.pyplot as plt
    if plt.get_fignums():
        images = []
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format='png')
            buf.seek(0)
            images.append(base64.b64encode(buf.read()).decode('utf-8'))
        if images:
            print("__MPL_IMAGES_START__")
            print(json.dumps(images))
            print("__MPL_IMAGES_END__")
except ImportError:
    pass
`;

            const fullCode = preamble + code + postamble;
            console.info(`[PythonLiteExecutor] Spawning Python: ${this.pythonExecutable!} with code length: ${fullCode.length}...`);
            const spawnStart = Date.now();
            const proc = spawn(this.pythonExecutable!, ['-c', fullCode], { shell: false });

            let stdout = '';
            let stderr = '';

            // Set up timeout to prevent hanging (60 seconds for ML workloads)
            const timeoutId = setTimeout(() => {
                console.error('[PythonLiteExecutor] Process timeout reached, killing process');
                proc.kill();
                stderr += '\n\nError: Execution timed out after 60 seconds. Consider simplifying your code or checking for infinite loops.';
            }, 60000); // 60 seconds timeout

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                // Clear the timeout since the process exited normally
                clearTimeout(timeoutId);

                const spawnEnd = Date.now();
                const spawnDuration = spawnEnd - spawnStart;
                console.info(`[PythonLiteExecutor] Python process exited with code ${code}. Duration: ${spawnDuration}ms`);

                const success = code === 0;
                let outputItems: vscode.NotebookCellOutputItem[] = [];

                // Process stdout to extract matplotlib images
                let cleanStdout = stdout;
                const startMarker = "__MPL_IMAGES_START__";
                const endMarker = "__MPL_IMAGES_END__";
                const images: string[] = [];
                if (stdout.includes(startMarker) && stdout.includes(endMarker)) {
                    const startIndex = stdout.indexOf(startMarker) + startMarker.length;
                    const endIndex = stdout.indexOf(endMarker, startIndex);
                    const jsonStr = stdout.substring(startIndex, endIndex).trim();
                    try {
                        const parsedImages = JSON.parse(jsonStr);
                        if (Array.isArray(parsedImages)) {
                            // Each element should be a base64 string
                            for (const img of parsedImages) {
                                if (typeof img === 'string') {
                                    images.push(img);
                                }
                            }
                        }
                        // Remove the marked lines from stdout
                        const lines = stdout.split('\n');
                        const newLines: string[] = [];
                        let skip = false;
                        for (const line of lines) {
                            if (line.startsWith(startMarker)) {
                                skip = true;
                                continue;
                            }
                            if (skip && line.startsWith(endMarker)) {
                                skip = false;
                                continue;
                            }
                            if (!skip) {
                                newLines.push(line);
                            }
                        }
                        cleanStdout = newLines.join('\n');
                    } catch (e) {
                        console.error('Failed to parse matplotlib images:', e);
                        // If parsing fails, we keep the original stdout and no images
                    }
                }

                if (success) {
                    // Add text output if there is any stdout (after removing image markers)
                    if (cleanStdout.trim()) {
                        outputItems.push(vscode.NotebookCellOutputItem.text(cleanStdout));
                    }
                    // Add image outputs
                    for (const imgBase64 of images) {
                        try {
                            const imgBuffer = Buffer.from(imgBase64, 'base64');
                            const imgUint8Array = new Uint8Array(imgBuffer);
                            outputItems.push(new vscode.NotebookCellOutputItem(imgUint8Array, 'image/png'));
                        } catch (e) {
                            console.error('Failed to create image output:', e);
                        }
                    }
                } else {
                    // On error, we still output the error with stderr
                    let errorOutput = stderr;
                    // Check for ModuleNotFoundError or ImportError and provide helpful hint
                    if (stderr.includes('ModuleNotFoundError:') || stderr.includes('ImportError:')) {
                        // Try to extract the module name
                        const moduleMatch = stderr.match(/(?:ModuleNotFoundError:|ImportError:)\s+No\s+module\s+named\s+['"]([^'"]+)['"]/);
                        if (moduleMatch && moduleMatch[1]) {
                            const missingModule = moduleMatch[1];
                            errorOutput += `\n\nHint: run "pip install ${missingModule}" in your terminal and try again`;
                        } else {
                            // Generic hint if we can't extract the module name
                            errorOutput += `\n\nHint: Check if required Python packages are installed. Try "pip install <package>" for missing modules`;
                        }
                    }
                    outputItems.push(vscode.NotebookCellOutputItem.error(new Error(errorOutput)));
                }

                const output = new vscode.NotebookCellOutput(outputItems);

                // Replace the output of the cell
                execution.replaceOutput(output).then(() => {
                    // Output set, now end the execution
                    execution.end(success, Date.now());
                }, (err) => {
                    // If setting output fails, still end the execution but log the error
                    console.error('Failed to set notebook cell output:', err);
                    execution.end(success, Date.now());
                });
            });

            // Handle process error events
            proc.on('error', (err) => {
                clearTimeout(timeoutId); // Clear timeout on error
                console.error('[PythonLiteExecutor] Process error:', err);
                const errorOutput = `Failed to spawn Python process: ${err.message}`;
                const output = new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(errorOutput))]);
                execution.replaceOutput(output).then(() => {
                    execution.end(false, Date.now());
                }, (err) => {
                    console.error('Failed to set notebook cell output:', err);
                    execution.end(false, Date.now());
                });
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const output = new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(`Failed to execute cell: ${errorMessage}`))]);
            execution.replaceOutput(output).then(() => {
                execution.end(false, Date.now());
            }, (err) => {
                console.error('Failed to set notebook cell output:', err);
                execution.end(false, Date.now());
            });
        }
    }
}