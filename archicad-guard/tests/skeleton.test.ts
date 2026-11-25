import { expect, test } from 'claude-code/testing'

test('the skeleton loads and a session starts', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  const started = await $.session.start({ cwd: 'D:/scratch/project', surface: 'desktop', isInteractive: true })

  expect(started.cwd).toBe('D:/scratch/project')
})
