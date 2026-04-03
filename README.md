# Asset Library Skill | [个人材料资产库Skill](./README.zh-CN.md)

![banner](./assets/banner.png)

`Asset Library Skill` is a skill set built around one idea: turning scattered personal documents into a personal asset library that you can search, reuse, maintain, and revisit over time.

It is not meant to be just a file classifier. It is designed to help you build a durable working library from resumes, certificates, transcripts, proofs, receipts, and other personal materials.

## What it helps you do

- Import personal documents into a working library
- Extract reusable assets from resumes, certificates, transcripts, proofs, and receipts
- Maintain the library through edits, archive actions, restore actions, and review
- Search materials with keywords, tags, or natural language
- Check which documents may need renewal or follow-up
- Build document packages for applications or archival use

## What it is not

- Not a standalone web app
- Not a general-purpose cloud drive
- Not a multi-user document collaboration platform
- Not, by default, an automated external demo-page submission tool

## How it works

The skill set is organized into stages:

1. `Import Personal Documents`
   Bring local files into the system as processable inputs.
2. `Build Personal Asset Library`
   Turn parsed materials into personal assets.
3. `Maintain Personal Asset Library`
   Review, patch, archive, restore, and clean up assets.
4. `Search Personal Asset Library`
   Find materials using filters, tags, or natural language.
5. `Check Document Renewal Requirements`
   Identify documents that may need renewal, follow-up, or replacement.
6. `Build Application Document Package`
   Assemble a package for application or record-keeping scenarios.

The root entry point is [Asset Library Skill](./SKILL.md). If you are unsure which phase to start with, or you want to describe the whole workflow in one request, start there.

## Example requests

- “Build an asset library from the personal documents in my downloads folder.”
- “Find documents I can reuse for a summer internship application.”
- “Check what may need renewal in the next 60 days.”
- “Archive the materials that should not stay in my personal asset library.”
- “Prepare an application document package.”

## Why this skill set is different

- It is centered on a personal asset library, not on one-off file tasks
- It supports ongoing maintenance, not just initial import
- It combines structured fields, semantic tags, and local retrieval for search
- It is intentionally conservative when the source is ambiguous

## Current MVP focus

The current MVP focuses on:

- import and library building
- asset maintenance
- reliable retrieval
- lifecycle checks
- document packaging

External demo-page submission is still available only as an advanced optional extension, not part of the default path.

## Getting started

If this is your first time:

1. Read [SKILL.md](./SKILL.md) to understand the main entry skill
2. Read [references/install.md](./references/install.md) to complete setup
3. Start from import or library building once the environment is ready

If you already have a library:

1. Start with `Search Personal Asset Library`
2. Or use `Maintain Personal Asset Library` to review and clean it up

## Documentation entry points

- Root skill: [SKILL.md](./SKILL.md)
- Installation guide: [references/install.md](./references/install.md)
- Skill overview: [docs/skills/README.md](./docs/skills/README.md)
- MCP overview: [docs/mcp/README.md](./docs/mcp/README.md)
- Main spec: [SPEC.md](./SPEC.md)

If you are looking for the competition-oriented project write-up, see [README.comp.md](./README.comp.md).
