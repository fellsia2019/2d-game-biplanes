import { open, rename } from 'node:fs/promises';
export class AtomicStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private path: string, private snapshot: () => unknown) {}
  idle() { return this.tail; }
  write() {
    const task = this.tail.then(async () => {
      const bytes = JSON.stringify(this.snapshot());
      const file = await open(this.path + '.tmp', 'w');
      try { await file.writeFile(bytes, 'utf8'); await file.sync(); } finally { await file.close(); }
      await rename(this.path + '.tmp', this.path);
    });
    this.tail = task.catch(() => {});
    return task;
  }
}
