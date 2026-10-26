import type { Task } from './client'
export type PendingTask = {
  temporaryID: number
  key: string
  data: Record<string, any>
  state: 'saving' | 'failed'
  error?: string
}
/** Parent/child writes share one queue. Failed parents block their children, not other roots. */
export class TaskCreationQueue {
  items: PendingTask[] = []
  private ids = new Map<number, number>()
  private sequence = -1
  private running = false
  constructor(
    private write: (data: Record<string, any>) => Promise<Task>,
    private changed: (items: PendingTask[]) => void,
    private saved: (item: PendingTask, task: Task) => void,
  ) {}
  enqueue(data: Record<string, any>) {
    const item: PendingTask = {
      temporaryID: this.sequence--,
      key: crypto.randomUUID(),
      data,
      state: 'saving',
    }
    this.items.push(item)
    this.emit()
    void this.drain()
    return item
  }
  retry(id: number) {
    const item = this.items.find((item) => item.temporaryID === id)
    if (item) {
      item.state = 'saving'
      item.error = undefined
      this.emit()
      void this.drain()
    }
  }
  private emit() {
    this.changed([...this.items])
  }
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      let item: PendingTask | undefined
      while (
        (item = this.items.find(
          (item) =>
            item.state === 'saving' &&
            (!item.data.parent || item.data.parent > 0 || this.ids.has(item.data.parent)),
        ))
      ) {
        const current = item
        try {
          const task = await this.write({
            ...current.data,
            ...(current.data.parent < 0 ? { parent: this.ids.get(current.data.parent) } : {}),
            clientRequestKey: current.key,
          })
          this.ids.set(current.temporaryID, task.id)
          this.items = this.items.filter((item) => item !== current)
          this.saved(current, task)
        } catch (error) {
          current.state = 'failed'
          current.error = (error as Error).message
        }
        this.emit()
      }
    } finally {
      this.running = false
    }
  }
}
