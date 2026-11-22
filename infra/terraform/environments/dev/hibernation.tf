variable "hibernation_enabled" {
  description = "Keep serving and schedules disabled and remove rebuildable fixed-cost resources while paused."
  type        = bool
  default     = false
}
