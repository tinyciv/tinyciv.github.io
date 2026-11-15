output "stack_outputs" {
  description = "Live CloudFormation outputs used by the application deployer."
  value       = aws_cloudformation_stack.multiplayer.outputs
}
