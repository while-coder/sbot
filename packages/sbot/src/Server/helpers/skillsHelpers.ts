import fs from 'fs';
import path from 'path';
import { SkillService } from 'scorpio.ai';

export class SkillHelper {
    list(skillsDir: string) {
        if (!fs.existsSync(skillsDir)) return [];
        const svc = new SkillService("", "", "", "");
        svc.registerSkillsDir(skillsDir);
        return svc.getAllSkills().map(s => ({
            path: s.path,
            name: s.name,
            description: s.description,
            dirName: path.basename(s.path),
        }));
    }

    save(skillsDir: string, name: string, content: string) {
        const skillDir = path.join(skillsDir, name);
        if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
        return { name };
    }

    delete(skillsDir: string, name: string) {
        const skillDir = path.join(skillsDir, name);
        if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
        return { name };
    }
}

export const skillHelper = new SkillHelper();
