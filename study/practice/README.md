# Practice scratchpad

Run TypeScript instantly here — `enum`s, classes, parameter properties, decorators, all of it.
(Plain `node file.ts` only *strips* types and chokes on `enum`/parameter properties; `tsx` handles
everything.)

## Two commands

**Run + auto-rerun on save** (your default loop — edit `scratch.ts`, hit save, watch it run):
```
npm run practice
```

**Run any single file once:**
```
npx tsx study/practice/two-sum.ts
```
(or `npx tsx watch study/practice/two-sum.ts` to re-run that specific file on save)

**Type-check everything in this folder** (catches the type errors interviewers care about — the
runners above execute your code but do *not* type-check it):
```
npm run check:practice
```

## Workflow for a practice problem
1. Make a file, e.g. `study/practice/valid-parens.ts`.
2. `npx tsx watch study/practice/valid-parens.ts` — it reruns every save.
3. When it works, `npm run check:practice` to confirm there are no hidden type errors.

Scratch files here are yours — commit the ones you want to keep, delete the rest.
