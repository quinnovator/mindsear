# Contributing

Thanks for helping. Bug reports, content packs and pull requests are all welcome.

## Setup

```sh
npm install
npm run build
npm run dev        # API on :8787
npm run dev:web    # web client on :5173
```

You need Node.js 26 or later. A model key is only needed to compile new objectives and grade explanations. See
`.env.example`.

## Before opening a pull request

```sh
npm run format
npm run check      # format check, typecheck, tests, pack validation (the same as CI)
```

- Keep one change per pull request, and explain why it's needed as well as what it does.
- Add or update tests for engine and pipeline changes. The simulated-learner tests in `test/sim.test.ts` play whole
  sessions without a model, so they are a good place to pin down teaching behavior.
- Decisions belong in code, and models only supply language. If a change lets a model decide whether a learner
  advances, how much help they get or whether an answer counts, it needs a strong argument.

## Writing a content pack

Packs live in `server/content/packs/<id>/` and implement the contract in `shared/content.ts`. Use `intro-probability`
as the model:

- `kcs.ts`: topics, their prerequisites and expectations;
- `misconceptions.ts`: named wrong ideas;
- `templates/`: one file per topic with parameterized items;
- `index.ts`: the pack definition, registered in `server/content/library.ts`.

`npm run pack:check` must pass. It checks for prerequisite cycles and missing capability coverage, and renders 1,000
random instances of every template.

## Reporting bugs

Open an issue with the steps to reproduce it, what you expected, and what happened. For tutoring problems, include
the session's turns if you can. `GET /api/account/export` returns them as JSON.

For security issues, see [SECURITY.md](SECURITY.md).
