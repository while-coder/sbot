export interface Skill {
    name: string;
    description: string;
    license?: string;
    path: string;
    type?: string;
    metadata?: Record<string, any>;
}
