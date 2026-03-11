// Memory categories (for LLM reference):
// fact: objective statements about the user or project (name, tech stack, config)
// preference: subjective likes, habits, style preferences
// decision: choices or directions made (e.g. "chose PostgreSQL")
// instruction: persistent requirements for the assistant (e.g. "always reply in Chinese")
// context: background info about the current project or task

export const MEMORY_SCORE_CRITERIA = `Importance scoring criteria (0.0–1.0):
- 0.0: No value — pure noise, meaningless tokens
- 0.1: Trivial — greetings, thanks, filler phrases, pleasantries
- 0.2: Negligible — rhetorical questions, chitchat with no informational content
- 0.3: Low — one-off questions, easily searchable common knowledge
- 0.4: Below average — transient context, short-lived status updates, ephemeral info
- 0.5: Moderate — general background info, may be useful but not critical
- 0.6: Above average — specific technical questions, project context worth retaining
- 0.7: High — clear user preferences, notable decisions, key facts about the project
- 0.8: Very high — important technical choices, architectural decisions, recurring patterns
- 0.9: Critical — core instructions, persistent rules, personal info the user expects to be remembered
- 1.0: Essential — permanent directives, identity-defining info, must never be forgotten`;
