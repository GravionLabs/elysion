# Sourced by backup.sh and restore.sh: the object store as rclone settings, from the same S3_* variables the services use.
# (Environment variables, not rclone's connection-string syntax: the colon of "http://host:9000" breaks that.)
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT="${S3_ENDPOINT:-}"
export RCLONE_S3_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
export RCLONE_S3_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"
export RCLONE_S3_FORCE_PATH_STYLE=true
