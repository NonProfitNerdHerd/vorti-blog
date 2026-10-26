/** One writer per task. A response only acknowledges the snapshot it actually saved. */
export class TaskSaveQueue<T extends Record<string, unknown>> {
  private saved: string
  private latest: T
  private running?: Promise<void>
  revision?: string
  error?: Error
  constructor(
    initial: T,
    revision: string | undefined,
    private write: (value: T, revision?: string) => Promise<string | undefined>,
  ) {
    this.latest = initial
    this.saved = JSON.stringify(initial)
    this.revision = revision
  }
  get dirty() {
    return this.saved !== JSON.stringify(this.latest)
  }
  update(value: T) {
    this.latest = value
  }
  flush(): Promise<void> {
    if (this.running) return this.running
    this.error = undefined
    this.running = this.drain().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async drain() {
    while (this.dirty) {
      const value = this.latest,
        signature = JSON.stringify(value)
      try {
        this.revision = await this.write(value, this.revision)
        this.saved = signature
      } catch (error) {
        this.error = error as Error
        throw error
      }
    }
  }
}
