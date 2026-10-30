import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encode } from 'gpt-tokenizer'
import { makeTodoApp, resetDom } from '../fixtures/todo-app'

// Token budgets (o200k_base). These are the "agent-first" claims made testable:
// raise a budget only with a reason, never to make a failing test pass.
const BUDGET = {
  // 520 → 560: added the generated-UI pointer; the spec grammar itself lives in manifest().docs.
  agentsMd: 560,
  snapshot20: 450,
  toggleDiff: 60,
  addDiff: 80,
  manifest: 80
}

const tokens = (text: string) => encode(text).length

beforeEach(resetDom)

describe('token budgets', () => {
  it('AGENTS.md fits the budget', () => {
    const text = readFileSync(resolve(__dirname, '../../../AGENTS.md'), 'utf8')
    expect(tokens(text)).toBeLessThanOrEqual(BUDGET.agentsMd)
  })

  it('a 20-item snapshot fits the budget', () => {
    const app = makeTodoApp(20)
    expect(tokens(app.see())).toBeLessThanOrEqual(BUDGET.snapshot20)
  })

  it('diffs after one interaction stay small', async () => {
    const app = makeTodoApp(20)
    const snap = app.see()
    const box = snap.match(/(e\d+) checkbox/)![1]!
    expect(tokens(await app.act(box, 'click'))).toBeLessThanOrEqual(BUDGET.toggleDiff)
    expect(tokens(await app.invoke('add', 'Buy milk'))).toBeLessThanOrEqual(BUDGET.addDiff)
  })

  it('the manifest fits the budget', () => {
    const app = makeTodoApp(20)
    expect(tokens(JSON.stringify(app.manifest()))).toBeLessThanOrEqual(BUDGET.manifest)
  })
})
