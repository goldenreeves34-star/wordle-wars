# Coding rules (Karpathy guidelines)

Adapted from forrestchang/andrej-karpathy-skills. Golden doesn't write code, so he can't catch extra changes himself. Follow these closely.

## 1. Think before coding
- State your assumptions. If something is unclear or has more than one reading, ask instead of guessing.
- If a simpler approach exists, say so. Push back when it's warranted.
- When no one is around to answer (an unattended or scheduled run), make the most reasonable call, note it at the top of your summary, and keep going.

## 2. Simplicity first
- Write the minimum code that solves the problem. No features beyond what was asked.
- No abstractions for single-use code, and no "flexibility" or settings nobody requested.
- Skip error handling only for things that truly can't happen. Keep checks that protect real users, data, or security (for games: always validate on the server).
- If 200 lines could be 50, rewrite it. Would a senior engineer call this overcomplicated? If yes, simplify.

## 3. Surgical changes
- Touch only what the request needs. Don't "improve" nearby code, comments, or formatting.
- Don't refactor what isn't broken. Match the existing style.
- Remove only what your own change made unused. Mention other dead code instead of deleting it.
- Test: every changed line should trace back to the request.

## 4. Goal-driven execution
- Turn each task into something checkable ("fix the bug" becomes "reproduce it, then show it's fixed").
- For multi-step work, give a short plan with a check for each step, and don't call it done until the checks pass.
