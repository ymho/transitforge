# Preserve active resource identities when leaving hibernation.
moved {
  from = aws_cloudwatch_metric_alarm.trip_changed_dlq
  to   = aws_cloudwatch_metric_alarm.trip_changed_dlq[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.trip_changed_lag
  to   = aws_cloudwatch_metric_alarm.trip_changed_lag[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.trip_changed_heartbeat
  to   = aws_cloudwatch_metric_alarm.trip_changed_heartbeat[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.trip_changed_tick_dlq
  to   = aws_cloudwatch_metric_alarm.trip_changed_tick_dlq[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.notification_tick_dlq
  to   = aws_cloudwatch_metric_alarm.notification_tick_dlq[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.trip_recheck_heartbeat
  to   = aws_cloudwatch_metric_alarm.trip_recheck_heartbeat[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.trip_recheck_tick_dlq
  to   = aws_cloudwatch_metric_alarm.trip_recheck_tick_dlq[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.rail_impact_failure
  to   = aws_cloudwatch_metric_alarm.rail_impact_failure[0]
}

moved {
  from = aws_eip.ai_egress
  to   = aws_eip.ai_egress[0]
}

moved {
  from = aws_instance.ai_nat
  to   = aws_instance.ai_nat[0]
}

moved {
  from = aws_eip_association.ai_nat
  to   = aws_eip_association.ai_nat[0]
}

moved {
  from = aws_route.ai_egress_private_internet
  to   = aws_route.ai_egress_private_internet[0]
}
