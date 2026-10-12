'use client'
import { Tasks } from './Tasks'
import './tasks.css'
export function TaskList() {
  return (
    <main className="review-global">
      <h1>Tasks</h1>
      <p>Review work across your site. Open a document to create a task.</p>
      <Tasks />
    </main>
  )
}
