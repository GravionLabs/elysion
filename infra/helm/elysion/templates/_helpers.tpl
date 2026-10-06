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
image (key in values.images / replicas / resources), port, probe (path), env (a list of environment variables, YAML).
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
  replicas: {{ index $root.Values.replicas .image }}
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
          # Not routed until the service answers, and restarted when it stops answering.
          readinessProbe:
            httpGet: { path: {{ .probe }}, port: http }
            periodSeconds: 5
            failureThreshold: 6
          livenessProbe:
            httpGet: { path: {{ .probe }}, port: http }
            initialDelaySeconds: 20
            periodSeconds: 10
            failureThreshold: 6
          resources:
            {{- toYaml (index $root.Values.resources .image) | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
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
