import { z } from 'zod'

const AssertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('contains'),     value: z.string() }),
  z.object({ type: z.literal('not_contains'), value: z.string() }),
  z.object({ type: z.literal('length_under'), value: z.number().positive() }),
  z.object({ type: z.literal('starts_with'),  value: z.string() }),
  z.object({ type: z.literal('regex'),        value: z.string() }),
  z.object({ type: z.literal('llm_judge'),    criteria: z.string().min(1) }),
])

const TestCaseSchema = z.object({
  id:     z.string().min(1),
  input:  z.string().min(1),
  vars:   z.record(z.string()).optional(),
  assert: z.array(AssertionSchema).min(1),
})

export const ConfigSchema = z.object({
  model:         z.string().min(1),
  judge_model:   z.string().min(1).default('gpt-4o-mini'),
  runs_per_test: z.number().int().min(1).max(10).default(1),
  concurrency:   z.number().int().min(1).max(20).default(5),
  tests:         z.array(TestCaseSchema).min(1),
})
