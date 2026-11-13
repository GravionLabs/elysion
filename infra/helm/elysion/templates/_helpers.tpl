{{- define "elysion.fullname" -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "elysion.labels" -}}
app.kubernetes.io/name: elysion
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* One secret key as an environment variable (a map: callers parse it with fromYaml and put it in a list). */}}
{{- define "elysion.secretEnv" -}}
name: {{ .name }}
valueFrom:
  secretKeyRef:
    name: {{ .root.Values.secrets.existingSecret }}
    key: {{ .key | default .name }}
{{- end -}}

{{/*
A Deployment and its Service for one component. Arguments: root (the chart context), name (frontend, bff, ...),
image (key in values.images / replicas / resources), port, probe (path), env (a list of environment variables, YAML),
runAsUser (the numeric user of the image: Kubernetes cannot check `runAsNonRoot` against a user name), writable (more
paths than /tmp that the process writes to; the root file system is read-only), startupSeconds (how long the process may take
to start), grace (seconds the process needs to stop after SIGTERM when the default 30 is too short; the preStop sleep is added).
*/}}
{{- define "elysion.component" -}}
{{- $root := .root -}}
{{- $full := printf "%s-%s" (include "elysion.fullname" $root) .name -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $full }}
  labels:
    {{- include "elysion.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ .name }}
spec:
  {{- if not (and (eq .image "realtime") $root.Values.autoscaling.realtime.enabled) }}
  replicas: {{ index $root.Values.replicas .image }}
  {{- end }}
  selector:
    matchLabels:
      app.kubernetes.io/instance: {{ $root.Release.Name }}
      app.kubernetes.io/component: {{ .name }}
  template:
    metadata:
      labels:
        {{- include "elysion.labels" $root | nindent 8 }}
        app.kubernetes.io/component: {{ .name }}
    spec:
      # The pod sleeps in preStop first (the endpoint is removed from Traefik meanwhile), then gets SIGTERM: the grace period
      # is the sleep plus the time the process needs. The realtime service saves every board with unsaved changes on
      # SIGTERM (ADR 0011), so it needs more than the default 30 s.
      terminationGracePeriodSeconds: {{ add (int $root.Values.shutdown.preStopSeconds) (int (.grace | default 30)) }}
      {{- if or (gt (int (index $root.Values.replicas .image)) 1) (and (eq .image "realtime") $root.Values.autoscaling.realtime.enabled) }}
      # Replicas of one component go to different nodes when they can (a node that fails takes one, not all).
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/instance: {{ $root.Release.Name }}
              app.kubernetes.io/component: {{ .name }}
      {{- end }}
      securityContext:
        runAsNonRoot: true
        runAsUser: {{ .runAsUser }}
        runAsGroup: {{ .runAsUser }}
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ .name }}
          {{- $img := index $root.Values.images .image }}
          image: "{{ $img.repository }}:{{ $img.tag }}"
          imagePullPolicy: {{ $img.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .port }}
          {{- with .env }}
          env:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          # Readiness and liveness wait for the start-up probe: the business backend migrates the database at start.
          startupProbe:
            httpGet: { path: {{ .probe }}, port: http }
            periodSeconds: 2
            failureThreshold: {{ div (.startupSeconds | default 60) 2 }}
          # Not routed until the service answers, and restarted when it stops answering.
          readinessProbe:
            httpGet: { path: {{ .probe }}, port: http }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: {{ .probe }}, port: http }
            periodSeconds: 10
            failureThreshold: 6
          {{- if gt (int $root.Values.shutdown.preStopSeconds) 0 }}
          # A rolling update must not route a request to a pod that is stopping: keep serving until the endpoint is gone.
          lifecycle:
            preStop:
              exec:
                command: ["sleep", {{ $root.Values.shutdown.preStopSeconds | quote }}]
          {{- end }}
          resources:
            {{- toYaml (index $root.Values.resources .image) | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            {{- range .writable }}
            - { name: {{ . | trimPrefix "/" | replace "/" "-" | replace "." "-" }}, mountPath: {{ . }} }
            {{- end }}
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }
        {{- range .writable }}
        - name: {{ . | trimPrefix "/" | replace "/" "-" | replace "." "-" }}
          emptyDir: { sizeLimit: 16Mi }
        {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $full }}
  labels:
    {{- include "elysion.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ .name }}
spec:
  selector:
    app.kubernetes.io/instance: {{ $root.Release.Name }}
    app.kubernetes.io/component: {{ .name }}
  ports:
    - name: http
      port: {{ .port }}
      targetPort: http
{{- end -}}

{{/* Replicas of a component that are always there: more than one, or the lower bound of the autoscaler. */}}
{{- define "elysion.minReplicas" -}}
{{- if and (eq .image "realtime") .root.Values.autoscaling.realtime.enabled -}}
{{- .root.Values.autoscaling.realtime.minReplicas -}}
{{- else -}}
{{- index .root.Values.replicas .image -}}
{{- end -}}
{{- end -}}

{{/* A podSelector for one component of this release (a NetworkPolicy peer). Arguments: root, name. */}}
{{- define "elysion.peer" -}}
podSelector:
  matchLabels:
    app.kubernetes.io/instance: {{ .root.Release.Name }}
    app.kubernetes.io/component: {{ .name }}
{{- end }}
