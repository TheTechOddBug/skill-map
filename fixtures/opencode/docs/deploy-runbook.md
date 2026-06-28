# Deploy runbook

1. Run the migrations skill against the target database.
2. Build the container image.
3. Roll out and watch health checks.

The deployer agent owns this runbook and runs it on every `/deploy`.
