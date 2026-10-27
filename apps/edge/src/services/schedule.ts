/**
 * ScheduleService now delegates to the shared deep module @applianceops/schedule-store.
 */
export {
	type AvailabilitySlot,
	checkAvailabilityUncached,
	ScheduleRepository as ScheduleService,
	ScheduleRepository,
} from "@applianceops/schedule-store";
