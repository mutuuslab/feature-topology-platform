import { z } from 'zod';

export const SoftwarePackageBody = z.object({
  fileId: z.string().uuid(),
  featureId: z.string().regex(/^FEAT-\d{5}$/),
  featureVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  swId: z.string().trim().min(1).max(120),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(['UPLOADED_SOFTWARE', 'EXECUTABLE_DEMO']),
  reason: z.string().trim().min(4).max(1000),
}).strict();
export type SoftwarePackageBody = z.infer<typeof SoftwarePackageBody>;
export const SoftwarePackageDecisionBody = z.object({
  revision: z.number().int().positive(),
  decision: z.enum(['APPROVE', 'REVOKE']),
  reason: z.string().trim().min(4).max(1000),
}).strict();
export type SoftwarePackageDecisionBody = z.infer<typeof SoftwarePackageDecisionBody>;
export const SoftwareDownloadCheckBody = z.object({vin:z.string().trim().min(1).max(60),flagKey:z.string().trim().min(1).max(100)}).strict();
export type SoftwareDownloadCheckBody = z.infer<typeof SoftwareDownloadCheckBody>;
