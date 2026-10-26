/**
 * ScheduleService now delegates to the shared deep module @applianceops/schedule-store.
 */
export {
  ScheduleRepository as ScheduleService,
  ScheduleRepository,
  checkAvailabilityUncached,
  type AvailabilitySlot,
} from "@applianceops/schedule-store";

