import express from 'express';
import { randomUUID } from 'crypto';
import { config } from '../../Core/Config';
import { api, throwBad } from '../../utils';

export interface SettingsCrudOptions {
    label?: string;
    checkOnUpdate?: boolean;
    checkOnDelete?: boolean;
    /**
     * 允许创建时由前端指定 id（slug）。不传则维持 randomUUID。
     * validate 做字符集等安全校验（id 会拼进文件路径/URL，必须收紧）；
     * 重名/非法在 POST 直接报错。key 创建后不可变（PUT 的 :id 即 key）。
     */
    clientId?: {
        validate(id: string): void;
    };
    /**
     * 删除流程在 config 落库 *之前* 调用——此时 profile 仍在 settings 里，可以走 resolver
     * 拉服务、做带 lifecycle 的清理（如 service.markForDeletion 触发 store.deleteAll）。
     */
    beforeDelete?: (id: string) => Promise<void> | void;
    afterDelete?: (id: string) => Promise<void> | void;
    afterSave?: (id: string) => Promise<void> | void;
    createReturn?: (id: string, body: any) => any;
    getSettings?: () => any;
}

/** 剥离 body 中混入的 id 字段：id 是 map 的键（URL 路径参数），不属于配置体。 */
function stripBodyId(req: express.Request): void {
    delete (req.body as any)?.id;
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
            let id: string;
            if (opts?.clientId) {
                id = String(req.body?.id ?? '').trim();
                stripBodyId(req);
                opts.clientId.validate(id);
                if (map[id]) throwBad(`${label} "${id}" already exists`);
            } else {
                id = randomUUID();
                while (map[id]) id = randomUUID();
            }
            map[id] = req.body;
            config.saveSettings();
            await opts?.afterSave?.(id);
            return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
        }));

        app.put(`/api/settings/${section}/:id`, api(async req => {
            const id = req.params.id as string;
            const map = getSection();
            if (checkOnUpdate && !map[id]) throwBad(`${label} "${id}" not found`);
            stripBodyId(req);
            map[id] = req.body;
            config.saveSettings();
            await opts?.afterSave?.(id);
            return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
        }));

        app.delete(`/api/settings/${section}/:id`, api(async req => {
            const id = req.params.id as string;
            const map = getSection();
            if (checkOnDelete && !map[id]) throwBad(`${label} "${id}" not found`);
            await opts?.beforeDelete?.(id);
            delete map[id];
            config.saveSettings();
            await opts?.afterDelete?.(id);
            await opts?.afterSave?.(id);
            return getSettings();
        }));
    }
}

export const settingsCrudHelper = new SettingsCrudHelper();
