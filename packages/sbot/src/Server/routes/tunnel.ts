import express from 'express';
import { TunnelProviderType, type TunnelConfig } from 'sbot.commons';
import { config } from '../../Core/Config';
import { tunnelService } from '../../Tunnel';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';

const VALID_PROVIDERS: ReadonlySet<string> = new Set(Object.values(TunnelProviderType));

function sanitizeConfig(input: any, idx: number): TunnelConfig {
    if (!input || typeof input !== 'object') throwBad(`tunnel[${idx}] must be an object`);
    const id = String(input.id ?? '').trim();
    if (!id) throwBad(`tunnel[${idx}].id is required`);
    if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(id)) throwBad(`tunnel[${idx}].id must match [A-Za-z0-9_-.]{1,64}`);
    const type = input.type;
    if (!VALID_PROVIDERS.has(type)) throwBad(`tunnel[${idx}].type invalid: ${type}`);

    const c: TunnelConfig = { id, type: type as TunnelProviderType };
    if (typeof input.name === 'string') c.name = input.name.trim() || undefined;
    if (typeof input.enabled === 'boolean') c.enabled = input.enabled;
    if (typeof input.cloudflareToken === 'string') c.cloudflareToken = input.cloudflareToken.trim() || undefined;
    if (typeof input.cloudflareTokenPublicUrl === 'string') c.cloudflareTokenPublicUrl = input.cloudflareTokenPublicUrl.trim() || undefined;
    if (typeof input.localtunnelSubdomain === 'string') c.localtunnelSubdomain = input.localtunnelSubdomain.trim() || undefined;
    return c;
}

function sanitizeList(input: any): TunnelConfig[] {
    if (!Array.isArray(input)) throwBad('Body must be an array of tunnel configs');
    const seen = new Set<string>();
    return input.map((item: any, i: number) => {
        const c = sanitizeConfig(item, i);
        if (seen.has(c.id)) throwBad(`Duplicate tunnel id: ${c.id}`);
        seen.add(c.id);
        return c;
    });
}

export class TunnelRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/tunnel/status', api(() => tunnelService.getStatus()));

        // 全量替换 tunnel 列表；body 是 TunnelConfig[]
        app.put('/api/tunnel/config', api(async (req) => {
            const next = sanitizeList(req.body);
            config.settings.tunnel = next;
            config.saveSettings();
            return { tunnel: config.settings.tunnel, status: tunnelService.getStatus() };
        }));

        app.post('/api/tunnel/start', api(async () => {
            await tunnelService.startAll(config.getHttpPort());
            return tunnelService.getStatus();
        }));

        app.post('/api/tunnel/stop', api(async () => {
            await tunnelService.stopAll();
            return tunnelService.getStatus();
        }));

        app.post('/api/tunnel/entries/:id/start', api(async (req) => {
            const id = String(req.params.id);
            await tunnelService.startEntry(id, config.getHttpPort());
            return tunnelService.getStatus();
        }));

        app.post('/api/tunnel/entries/:id/stop', api(async (req) => {
            const id = String(req.params.id);
            await tunnelService.stopEntry(id);
            return tunnelService.getStatus();
        }));
    }
}

export const tunnelRoutes = new TunnelRoutes();
