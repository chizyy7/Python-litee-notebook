import * as vscode from 'vscode';

/**
 * Convert Jupyter kernel outputs to VS Code NotebookCellOutputItem format
 */
export class MessageMapper {
    /**
     * Convert a stream output (stdout/stderr) to NotebookCellOutputItem
     */
    public static streamToOutputItem(name: string, text: string): vscode.NotebookCellOutputItem {
        // Map Jupyter stream names to VS Code output types
        if (name === 'stderr') {
            return vscode.NotebookCellOutputItem.error(new Error(text));
        } else {
            // stdout and other streams go to text output
            return vscode.NotebookCellOutputItem.text(text);
        }
    }

    /**
     * Convert an execute_result output to NotebookCellOutputItem
     */
    public static executeResultToOutputItem(data: { [mimeType: string]: any }, executionCount: number): vscode.NotebookCellOutputItem[] {
        const items: vscode.NotebookCellOutputItem[] = [];

        // Handle text/plain output
        if (data['text/plain']) {
            items.push(vscode.NotebookCellOutputItem.text(data['text/plain']));
        }

        // Handle other MIME types if needed (for now, we'll just log them)
        // In a full implementation, we'd convert images, HTML, etc. to appropriate output types
        for (const [mimeType, value] of Object.entries(data)) {
            if (mimeType !== 'text/plain') {
                console.log(`Unsupported MIME type in execute_result: ${mimeType}`);
                // For now, we could convert to text representation
                if (typeof value === 'string') {
                    items.push(vscode.NotebookCellOutputItem.text(`[${mimeType}] ${value}`));
                }
            }
        }

        return items;
    }

    /**
     * Convert an error output to NotebookCellOutputItem
     */
    public static errorToOutputItem(ename: string, evalue: string, traceback: string[]): vscode.NotebookCellOutputItem {
        const errorText = `${ename}: ${evalue}\n${traceback.join('\n')}`;
        return vscode.NotebookCellOutputItem.error(new Error(errorText));
    }

    /**
     * Convert a complete set of Jupyter outputs to VS Code NotebookCellOutput format
     */
    public static jupyterOutputsToNotebookOutput(outputs: any[]): vscode.NotebookCellOutput {
        const items: vscode.NotebookCellOutputItem[] = [];

        for (const output of outputs) {
            switch (output.output_type) {
                case 'stream':
                    items.push(
                        MessageMapper.streamToOutputItem(output.name, output.text)
                    );
                    break;

                case 'execute_result':
                    items.push(
                        ...MessageMapper.executeResultToOutputItem(
                            output.data,
                            output.execution_count || null
                        )
                    );
                    break;

                case 'error':
                    items.push(
                        MessageMapper.errorToOutputItem(
                            output.ename,
                            output.evalue,
                            output.traceback || []
                        )
                    );
                    break;

                default:
                    console.log(`Unsupported output type: ${output.output_type}`);
                    // Convert unknown types to text for now
                    items.push(vscode.NotebookCellOutputItem.text(
                        `[${output.output_type}] ${JSON.stringify(output)}`
                    ));
                    break;
            }
        }

        return new vscode.NotebookCellOutput(items);
    }
}