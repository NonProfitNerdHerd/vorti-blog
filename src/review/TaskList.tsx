'use client'
import { Tasks } from './Tasks'
import './tasks.css'
export function TaskList() {
  return (
    <main className="review-global">
      <header className="task-dashboard-heading">
        <div>
          <p>Review workspace</p>
          <h1>Tasks</h1>
        </div>
        <span>Keep your site’s next steps in view.</span>
      </header>
      <Tasks />
    </main>
  )
}
