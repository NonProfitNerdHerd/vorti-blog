// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FormRenderer } from './FormRenderer'
import { supportExample } from './graph-example'

afterEach(cleanup)
it('validates before advancing, changes branch after Back and accepts only once', async () => {
  const submit = vi.fn(async () => ({ message: 'Accepted' }))
  render(<FormRenderer definition={supportExample()} onSubmit={submit} />)
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  next(); expect(screen.getByRole('alert').textContent).toContain('required')
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } }); fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } }); next()
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'ada@example.com' } }); next()
  fireEvent.change(screen.getByLabelText(/What do you need help/), { target: { value: 'teams' } }); next()
  fireEvent.change(screen.getByLabelText(/Describe your Teams/), { target: { value: 'Old branch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.change(screen.getByLabelText(/What do you need help/), { target: { value: 'email' } }); next()
  fireEvent.change(screen.getByLabelText(/Describe your Email/), { target: { value: 'Help' } }); next()
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Confirmation' })).toBeTruthy())
  expect(submit).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
  expect(submit).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Thank you. Your support request is complete.')).toBeTruthy()
})
it('preview never calls the submission adapter', async () => {
  const d = supportExample(); d.fields = []; d.graph!.nodes = [{ id: 'start', name: 'Start', kind: 'start' }, { id: 'message', name: 'Message', kind: 'message', message: 'Ready?' }, { id: 'submit', name: 'Submit', kind: 'submit' }, { id: 'end', name: 'End', kind: 'end', message: 'Finished' }]; d.graph!.edges = [{ id: 'a', source: 'start', output: 'next', target: 'message' }, { id: 'b', source: 'message', output: 'next', target: 'submit' }, { id: 'c', source: 'submit', output: 'success', target: 'end' }]
  const submit = vi.fn()
  render(<FormRenderer definition={d} preview onSubmit={submit} />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(screen.getByText('Finished')).toBeTruthy())
  expect(submit).not.toHaveBeenCalled()
})
