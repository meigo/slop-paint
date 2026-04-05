/**
 * Undo/Redo via canvas snapshots.
 * Stores ImageData for each completed stroke.
 */
export class History {
  private undoStack: ImageData[] = [];
  private redoStack: ImageData[] = [];
  private maxSize = 50;

  push(snapshot: ImageData) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    // New action clears redo
    this.redoStack = [];
  }

  undo(currentState: ImageData): ImageData | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(currentState);
    return this.undoStack.pop()!;
  }

  redo(currentState: ImageData): ImageData | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(currentState);
    return this.redoStack.pop()!;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
