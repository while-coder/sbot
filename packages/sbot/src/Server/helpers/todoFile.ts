import fsp from 'fs/promises';

export class TodoFileHelper {
    async mutate(filePath: string, mutator: (data: any) => void): Promise<void> {
        const buf = await fsp.readFile(filePath, 'utf-8').catch(() => '{"todos":[],"nextId":1}');
        const data = JSON.parse(buf);
        if (!Array.isArray(data.todos)) data.todos = [];
        if (typeof data.nextId !== 'number') data.nextId = 1;
        mutator(data);
        const tmp = `${filePath}.tmp`;
        try {
            await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
            await fsp.rename(tmp, filePath);
        } catch (e) {
            await fsp.unlink(tmp).catch(() => {});
            throw e;
        }
    }
}

export const todoFileHelper = new TodoFileHelper();
