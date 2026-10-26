import type { Job } from "../types";

/**
 * Map domain Job patches back to Workiz REST body fields for updateJob.
 * Refine against developer.workiz.com when going live.
 */
export function jobPatchToWorkizApi(patch: Partial<Job>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.status !== undefined) body.Status = patch.status;
  if (patch.scheduledAt !== undefined) body.JobDateTime = patch.scheduledAt;
  if (patch.assignedTechId !== undefined) body.TechUUID = patch.assignedTechId;
  if (patch.partsStatus !== undefined) {
    body.PartsStatus =
      patch.partsStatus === "in_stock"
        ? "In Stock / Received"
        : patch.partsStatus === "backordered"
          ? "Backordered"
          : "None";
  }
  if (patch.partsEta !== undefined) body.PartsETA = patch.partsEta;
  return body;
}
