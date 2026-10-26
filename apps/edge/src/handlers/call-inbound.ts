import type { ScheduleService } from "../services/schedule";

export type InboundBody = {
  call_inbound?: { from_number?: string; to_number?: string };
  from_number?: string;
};

/**
 * Retell inbound webhook: return dynamic variables for personalization.
 */
export async function buildCallInboundResponse(
  schedule: ScheduleService,
  body: InboundBody,
): Promise<Record<string, unknown>> {
  const from = body.call_inbound?.from_number ?? body.from_number ?? "";

  const jobs = from ? await schedule.findJobsByPhoneCached(from) : [];
  const open = jobs.find(
    (j) =>
      !["cancelled", "canceled", "done", "completed"].includes(
        j.status.toLowerCase(),
      ),
  );

  if (!open) {
    return {
      call_inbound: {
        dynamic_variables: {
          customer_name: "there",
          open_job_status: "none",
          assigned_tech: "",
          job_id: "",
          appliance: "",
          known_caller: "false",
        },
      },
    };
  }

  return {
    call_inbound: {
      dynamic_variables: {
        customer_name: open.customerName.split(" ")[0] || open.customerName,
        open_job_status: open.status,
        assigned_tech: open.assignedTechName ?? "",
        job_id: open.id,
        appliance: open.appliance,
        model_serial: open.modelSerial ?? "",
        parts_status: open.partsStatus,
        known_caller: "true",
      },
    },
  };
}
