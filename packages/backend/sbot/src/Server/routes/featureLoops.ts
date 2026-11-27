import { createHash, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import { createFeatureLoopSchema, featureLoopService } from '../../Agent/FeatureLoopService';
import { api, throwBad } from '../../utils';

const resumeSchema = z.object({
    useCurrentSpec: z.boolean().default(false),
    spec: z.object({
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        text: z.string().max(60_000).refine(text => Boolean(text.trim())),
    }).optional(),
});

export function featureLoopsEnabled(): boolean {
    return Boolean(process.env.SBOT_FEATURE_LOOP_TOKEN?.trim());
}

export function registerFeatureLoopRoutes(app: express.Application): void {
    if (!featureLoopsEnabled()) return;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    const expected = digest(`Bearer ${process.env.SBOT_FEATURE_LOOP_TOKEN!.trim()}`);
    app.use('/api/feature-loops', (req, res, next) => {
        if (!timingSafeEqual(expected, digest(req.get('Authorization') ?? ''))) {
            res.status(401).json({ success: false, message: 'Feature Loop authorization required' });
            return;
        }
        next();
    });
    app.get('/api/feature-loops', api(() => featureLoopService.list()));
    app.post('/api/feature-loops', api(req => {
        const parsed = createFeatureLoopSchema.safeParse(req.body);
        if (!parsed.success) throwBad(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
        return featureLoopService.create(parsed.data);
    }));
    app.get('/api/feature-loops/:id', api(req => featureLoopService.get(String(req.params.id))));
    app.get('/api/feature-loops/:id/spec', api(req => featureLoopService.getSpec(String(req.params.id))));
    app.post('/api/feature-loops/:id/pause', api(req => featureLoopService.pause(String(req.params.id))));
    app.post('/api/feature-loops/:id/resume', api(req => {
        const parsed = resumeSchema.safeParse(req.body ?? {});
        if (!parsed.success) throwBad(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
        return featureLoopService.resume(String(req.params.id), parsed.data.useCurrentSpec, parsed.data.spec);
    }, { logBody: false }));
}
