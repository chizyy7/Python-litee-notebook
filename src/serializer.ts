import * as vscode from 'vscode';

export class PythonLiteSerializer implements vscode.NotebookSerializer {
    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        try {
            const jsonStr = new TextDecoder().decode(content);
            console.info('[PythonLiteSerializer] Deserializing notebook JSON:', jsonStr.substring(0, 200));
            const obj = JSON.parse(jsonStr);
            const cells: vscode.NotebookCellData[] = obj.map((cell: { kind?: string; value?: string }) => {
                const kind = cell.kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup;
                // Default to empty string if value missing
                const text = cell.value ?? '';
                return new vscode.NotebookCellData(kind, text, cell.kind === 'code' ? 'python' : 'markdown');
            });
            return new vscode.NotebookData(cells);
        } catch (err) {
            console.error('[PythonLiteSerializer] Failed to deserialize notebook:', err);
            // Return an empty notebook on error to avoid breaking the editor
            return new vscode.NotebookData([]);
        }
    }

    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        try {
            const obj = data.cells.map(cell => {
                return {
                    kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
                    value: cell.value
                };
            });
            const jsonStr = JSON.stringify(obj, undefined, 2);
            console.info('[PythonLiteSerializer] Serializing notebook JSON:', jsonStr.substring(0, 200));
            return new TextEncoder().encode(jsonStr);
        } catch (err) {
            console.error('[PythonLiteSerializer] Failed to serialize notebook:', err);
            // Return empty array JSON on error
            return new TextEncoder().encode('[]');
        }
    }
}