import { Skill } from "./types";
import { UsageTracker } from "../Utils/UsageTracker";

export function formatSkillItems(skills: Skill[]): string {
    return skills
        .map(s => {
            const usage = new UsageTracker(s.path).get();
            const usageAttr = usage ? ` uses="${usage.useCount}" lastUsed="${usage.lastUsedAt ?? 'never'}"` : '';
            const typeAttr = s.type ? ` type="${s.type}"` : '';
            return `  <skill name="${s.name}" path="${s.path}"${typeAttr}${usageAttr}>${s.description}</skill>`;
        })
        .join("\n");
}
