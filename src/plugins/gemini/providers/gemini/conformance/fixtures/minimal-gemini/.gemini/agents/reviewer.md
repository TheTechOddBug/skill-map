---
name: reviewer
description: A minimal Gemini subagent that reviews supplied text for tone, clarity, and grammar.
model: gemini-3-flash-preview
tools:
  - Read
  - Edit
temperature: 0.7
max_turns: 5
metadata:
  version: 1.0.0
  stability: stable
---

# Reviewer

A subagent that performs lightweight prose review. Used as the agent-kind fixture for the Gemini Provider.
