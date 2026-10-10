# The backup of the stack (docs/self-hosting.md, "Back up and restore"): pg_dump of the databases and a copy of the
# object store, on a schedule. The Postgres image of the stack, so that pg_dump matches the server's major version.
FROM postgres:18-alpine
RUN apk add --no-cache bash rclone tzdata
COPY entrypoint.sh backup.sh restore.sh s3env.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
