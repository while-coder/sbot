import express from 'express';
import { randomUUID } from 'crypto';
import { config } from '../../Core/Config';
import { api, throwBad } from '../utils';

export interface SettingsCrudOptions {
    label?: string;
    checkOnUpdate?: boolean;
    checkOnDelete?: boolean;
    beforeDelete?: (id: string) => void;
    afterDelete?: (id: string) => Promise<void> | void;
    afterSave?: (id: string) => Promise<void> | void;
    createReturn?: (id: string, body: any) => any;
    getSettings?: () => any;
}

export class SettingsCrudHelper {
    /** 注册标准 Settings CRUD 路由 (POST/PUT/DELETE) */
    register(app: express.Application, section: string, opts?: SettingsCrudOptions) {
        const label = opts?.label ?? section.charAt(0).toUpperCase() + section.slice(1, -1);
        const checkOnUpdate = opts?.checkOnUpdate ?? true;
        const checkOnDelete = opts?.checkOnDelete ?? false;
        const getSettings = opts?.getSettings ?? (() => config.settings);
        const getSection = (): Record<string, any> => {
            const s = config.settings as Record<string, Record<string, any> | undefined>;
            if (!s[section]) s[section] = {};
            return s[section]!;
        };

        app.post(`/api/settings/${section}`, api(async req => {
            const map = getSection();
            let id = randomUUID();
            while (map[id]) id = randomUUID();
            map[id] = req.body;
            config.saveSettings();
            await opts?.afterSave?.(id);
            return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
        }));

        app.put(`/api/settings/${section}/:id`, api(async req => {
            const id = req.params.id as string;
            const map = getSection();
            if (checkOnUpdate && !map[id]) throwBad(`${label} "${id}" not found`);
            map[id] = req.body;
            config.saveSettings();
            await opts?.afterSave?.(id);
            return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
        }));

        app.delete(`/api/settings/${section}/:id`, api(async req => {
            const id = req.params.id as string;
            opts?.beforeDelete?.(id);
            const map = getSection();
            if (checkOnDelete && !map[id]) throwBad(`${label} "${id}" not found`);
            delete map[id];
            config.saveSettings();
            await opts?.afterDelete?.(id);
            await opts?.afterSave?.(id);
            return getSettings();
        }));
    }
}

export const settingsCrudHelper = new SettingsCrudHelper();
