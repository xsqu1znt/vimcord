# Vimcord

Vimcord is an opinionated Discord.js framework for typed modules, command dispatching, and reusable UX tools.

It wraps `Discord.js` with a focused module layer, typed contexts, hooks hooks, and UX helpers for embeds, prompts, modals, components, pagination, and more.

It does not hide Discord.js. You still use Discord.js builders, intents, events, permissions, and interactions directly it's the right tool.

# qznt

Vimcord also makes use of `qznt` - a small utility library that we also can have patched, or new things implemented upstream just. Just ask. Before writing any code that requires a certain utility, check whether `qznt` already has it, or for patterns around the repo that already use `qznt`. If it's generic enough that makes sense to add it upstream, suggest it to us.

# How we work

Vimcord is used for high performance and large bots. That means every function, every system, every flow, and every API that it touches, should be designed in a clean, optimized way using professional techniques, and as easily scalable as possible. Less code is more, and simplicity wins over accounting for 100 edge cases that users will never hit. If it's not going to benefit the features we're building in the long run, we don't need it.

Nevertheless, here are a few things that must be followed while working on the task you're given:

- PNPM must always be preferred over NPM, unless explicitly asked, or PNPM doesn't support what we're trying to do.
- When verifying a completed task, run `pnpm format && pnpm check` and fix what it flags. If it flags something that is outside of the scope of the task at hand, state it briefly, and ask if we want you to fix it, instead of going off to fix it immediately.
- If the task was to only make a small mechanical edit, only `pnpm format` should be used. It does not need a type check nor a build.
- Whenever `pnpm format` is ran, don't revert its changes. Even if it changed files outside of the current scope.
- This is a Discord bot, we don't need a series of test files to validate what could be caught with a simple type check or a focused smoke test for more complicated areas.

# Hit every surface

One common defect in this repo is changing one thing in one place, and forgetting to check for other paths that might not have been updated to match.

Let's say you change the way something is worded, and other commands all had a pattern they followed for the same kind of thing. There should be a distinction whether it was intentional to be different from the rest, or those other commands were just ignored.

Or, say you cleaned up the way one path handled some data, while there are other paths that also handle the same kind of data, but they were ignored instead of reaping the benefit of the new simpler way.

This leads to inconsistency which is very bad, and makes other agents, and humans, go off the beaten road during future sessions. Slowing devolving into a repo full of slop that nobody can keep up with and maintain.

If you changed the way userIds were extracted, or you found a clever way of omitting a series of try-catches, if statements, or function shapes, the rest of the repo should reap the benefit of this instead of leaving them behind in the dust.

# Conventions

- File names use `PascalCase` when exporting a main class, otherwise `camelCase`.
- Classes and types use `PascalCase`, variables and functions use `camelCase`, while top level constants use `SCREAMING_SNAKE_CASE`.
- Barrel-export new files only if the surrounding files are currently being re-exported through their nearest `index.ts`.

# Planning

When planning out a big feature, or implementing across multiple modules, use the following 3-step process:

1. **Alignment phase.** This is the most important read-only, no-code phase where we ask questions and go over important details of how things should work. Important but not over-engineered edge-cases, sane defaults, and open questions for things that we may be unsure about. We need to be on the same page so something that wasn't asked for doesn't get implemented. Keep it simple, no technical details, no code examples unless explicitly asked for. Just how it would be implemented, what needs to be touched, any inconsistencies, creative questions, and concerns or things you noticed. Don't be afraid to suggest something bold if it benefits what we're trying to achieve. If the feature involves user-facing things, draft what messages, embeds, containers, formatting, etc, look like that you want to implement. That way we can iterate on design and copy if needed.
2. **Technical phase.** This is also a read-only pass. Once we come to an agreement in the alignment phase, we'll talk about the technical details. Persistence, schemas, existing blockers, optimization, commands, services, etc. Don't write up a whole essay, keep it simple. We should be aligned on what needs to be implemented before continuing.
3. **Implementation phase.** Once we're aligned in both of the previous stages and the plan is approved, this is when you actually write the code.

# Taste

- Complexity belongs at in the internal layers. Orchestration stays pure.
- Separate blocks of code into sections using a comment to help show each stage or part of an otherwise long read of code.
- Don't use big fancy words to explain something. Don't reply using technical jargon, and don't give user-facing things explanations or descriptions with technical or advanced english details that only our repo maintainers would understand. We can't assume the user knows what "Size is a width x height grid" is supposed to mean when describing what "3x2" means.
- If a rule here fights the task in front of you, say so loudly and ask for permission before breaking it.
- If you find that a rule here is broken while working on a task, say it loudly and let us know your plan, wait for permission so we know what was caught, then fix it. Continue the effort to clean up and keep things clean. Don't allow a pattern of broken rules to continue existing.

# Hard rules

- Never read `.env` files. `.env.example` files are fine as they should not have sensitive secrets inside of them to better understand the environment shape.
- Never read or touch a live production database.
- Never hard-code secrets, tokens, or IDs.