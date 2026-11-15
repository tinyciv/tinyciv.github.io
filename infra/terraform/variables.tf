variable "ami_id" {
  description = "Pinned Amazon Linux 2023 AMI. Change deliberately; following latest would replace the host."
  type        = string
  default     = "ami-09f02015912e773f7"
}

variable "instance_type" {
  description = "Multiplayer host size. Changing this stops and restarts the instance."
  type        = string
  default     = "t3.small"

  validation {
    condition     = contains(["t3.micro", "t3.small"], var.instance_type)
    error_message = "Choose t3.micro or t3.small."
  }
}
