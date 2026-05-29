# Tilelli Executable Specification System

<!--
Form: Markdown
Runtime: Human reader, GitHub renderer, agent context loader.
Execution: Read this file as doctrine. Validate machine-facing declarations against spec/specification-system.manifest.json.
Safety: This file may describe secrets, but must not contain secret values.
-->

## Purpose

The Tilelli specification system defines how every artifact in the project-of-projects explains itself while remaining valid in its own runtime.

The goal is not documentation beside the system. The goal is documentation as part of the system: each file should state its purpose, execution mode, dependencies, safety boundaries, and relation to the organism in the native comment form of that filetype.

## Core Principle

Every form must be:

- **Executable**: saving the artifact in its declared filetype must preserve its runtime validity.
- **Self-describing**: the artifact must describe what it is for and how it participates.
- **Scoped**: project-specific operations use `TILELLI_` names and avoid machine-wide collisions.
- **Composable**: each artifact must name the other forms it depends on or feeds.
- **Auditable**: generated action, deployment, migration, and mutation should leave a trace.
- **Least-privilege**: bootstrap/root credentials mint narrower capabilities and then step aside.

## Required Header Doctrine

Each executable/spec artifact should include a native comment header containing these fields when the filetype permits comments:

- `Form`: filetype/runtime form.
- `Runtime`: what executes or interprets this file.
- `Purpose`: why it exists.
- `Inputs`: environment variables, files, APIs, bindings, or user actions it depends on.
- `Outputs`: files, data, APIs, UI effects, database writes, deployments, or logs it produces.
- `Safety`: secrets, write boundaries, auth rules, destructive operations, or privacy constraints.
- `Relations`: nearby files or systems this artifact coordinates with.

If the filetype does not permit comments, such as strict JSON, these fields must be represented as data fields.

## Form Registry

### HTML

Comment form:

```html
<!--
Form: HTML
Runtime: Browser
Purpose: Visible world surface.
Inputs: User interaction, API responses, local storage.
Outputs: Rendered UI, client events, API writes.
Safety: Never embed owner secrets or server credentials.
Relations: CSS, browser JavaScript, Worker API.
-->
```

HTML owns public embodiment: the pages people see and touch.

### CSS

Comment form:

```css
/*
Form: CSS
Runtime: Browser style engine
Purpose: Visual law, layout, motion, atmosphere.
Safety: Prefer responsive constraints; respect reduced-motion.
*/
```

CSS owns atmosphere and motion, but should not pretend to be application state.

### Browser JavaScript

Comment form:

```js
/*
Form: Browser JavaScript
Runtime: Browser
Purpose: Client behavior and API interaction.
Inputs: DOM, events, public API endpoints.
Outputs: UI state, local storage, fetch calls.
Safety: Never include private keys; treat all client data as user-controlled.
*/
```

Browser JS may call Workers, but must not hold owner secrets.

### Worker JavaScript / TypeScript

Comment form:

```js
/*
Form: Cloudflare Worker
Runtime: Cloudflare Workers
Purpose: Edge API and scheduled automation.
Inputs: Request, env bindings, D1, cron event.
Outputs: JSON responses, D1 writes, logs.
Safety: Validate input; require owner keys for private writes.
Relations: wrangler.toml, D1 SQL migrations, GitHub Actions.
*/
```

Workers are the edge nervous system.

### SQL

Comment form:

```sql
-- Form: SQL
-- Runtime: Cloudflare D1 / SQLite
-- Purpose: Persistent memory schema and migrations.
-- Safety: Migrations must be idempotent when possible and preserve user data.
```

SQL owns memory.

### TOML

Comment form:

```toml
# Form: TOML
# Runtime: Wrangler
# Purpose: Cloudflare Worker configuration and bindings.
# Safety: Do not store secret values here; use Worker secrets or environment variables.
```

TOML binds code to Cloudflare resources.

### YAML

Comment form:

```yaml
# Form: YAML
# Runtime: GitHub Actions
# Purpose: CI, deployment, scheduled virtual execution.
# Safety: Use GitHub secrets for tokens; avoid printing secrets.
```

YAML owns repository-side automation.

### JSON

Strict JSON has no comments. Use data fields:

```json
{
  "form": "JSON",
  "runtime": "Agent or validator",
  "purpose": "Structured capability declaration",
  "safety": ["No comments", "No secret values"]
}
```

JSON owns machine-readable declarations.

### Markdown

Comment form:

```md
<!--
Form: Markdown
Runtime: Human reader, renderer, agent context
Purpose: Doctrine, architecture, operating notes.
Safety: May describe secrets but must not contain secret values.
-->
```

Markdown owns doctrine and narrative architecture.

### Shell / Env

Comment form:

```sh
# Form: Shell
# Runtime: POSIX shell / zsh
# Purpose: Bootstrap repeatable local operations.
# Safety: Prefer token files or keychains over literal secrets.
```

Shell owns local repeatability.

### SVG

Comment form:

```xml
<!--
Form: SVG
Runtime: Browser / image renderer
Purpose: Vector sigil, diagram, map, or icon.
Safety: Avoid embedded scripts unless explicitly required.
-->
```

SVG owns symbolic graphics and diagrams.

## Autopoietic Requirement

An artifact participates in the Tilelli system when it can answer:

1. What am I?
2. What executes me?
3. What do I need?
4. What do I produce?
5. What can I damage?
6. What am I allowed to touch?
7. What other forms do I feed?
8. How can an agent verify me?

## Quine Requirement

The specification system should increasingly be able to regenerate its own skeleton:

- the form registry,
- required headers,
- validation scripts,
- agent capability forms,
- D1 migration templates,
- Worker route templates,
- GitHub Actions templates,
- Wrangler templates,
- and docs.

This does not mean every artifact literally prints its own source. It means every artifact carries enough structured intent that an agent can reconstruct, validate, migrate, or evolve it without guessing.

## Initial Implementation Target

The first implementation pass must provide:

- this doctrine file,
- a machine-readable manifest,
- a validator that checks required artifacts,
- native headers added to Worker, SQL, TOML, YAML, and agent JSON forms,
- and a rule that no browser artifact contains private credentials.

