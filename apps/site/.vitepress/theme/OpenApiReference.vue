<script setup lang="ts">
// The reference of the public API, rendered from the committed OpenAPI document at build time (no request at run time).
import document from '../../../../docs/api/openapi.v1.json';
import { type OpenApiDocument, inlineCode, referenceOf } from './openapi.mts';

const groups = referenceOf(document as OpenApiDocument);
</script>

<template>
  <div class="openapi-reference">
    <section v-for="group in groups" :key="group.id">
      <h2 :id="group.id" tabindex="-1">
        {{ group.tag }} <a class="header-anchor" :href="`#${group.id}`" aria-hidden="true"></a>
      </h2>
      <section v-for="operation in group.operations" :key="operation.id" class="operation">
        <h3 :id="operation.id" tabindex="-1">
          {{ operation.summary }}
          <a class="header-anchor" :href="`#${operation.id}`" aria-hidden="true"></a>
        </h3>
        <p>
          <code class="method">{{ operation.method }}</code> <code>{{ operation.path }}</code>
          <span v-if="operation.scope">
            · scope <code>{{ operation.scope }}</code></span
          >
        </p>
        <p
          v-for="(paragraph, index) in operation.description.split('\n\n')"
          :key="index"
          v-html="inlineCode(paragraph)"
        ></p>

        <table v-if="operation.parameters.length > 0">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>In</th>
              <th>Type</th>
              <th>Description</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="parameter in operation.parameters"
              :key="`${parameter.in}-${parameter.name}`"
            >
              <td>
                <code>{{ parameter.name }}</code
                ><span v-if="parameter.required"> (required)</span>
              </td>
              <td>{{ parameter.in }}</td>
              <td>{{ parameter.type }}</td>
              <td v-html="inlineCode(parameter.description)"></td>
              <td>
                <code v-if="parameter.example">{{ parameter.example }}</code>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-for="body in operation.requestBody" :key="body.mediaType">
          <p>
            <strong>Body</strong> <code>{{ body.mediaType }}</code> {{ body.schema }}
          </p>
          <div v-if="body.example" class="language-json">
            <pre><code>{{ body.example }}</code></pre>
          </div>
        </div>

        <details
          v-for="response in operation.responses"
          :key="response.status"
          :open="response.status.startsWith('2')"
        >
          <summary>
            <code>{{ response.status }}</code>
            <span v-html="inlineCode(response.description)"></span>
          </summary>
          <div v-for="body in response.bodies" :key="body.mediaType">
            <p>
              <code>{{ body.mediaType }}</code> {{ body.schema }}
            </p>
            <div v-if="body.example" class="language-json">
              <pre><code>{{ body.example }}</code></pre>
            </div>
          </div>
        </details>
      </section>
    </section>
  </div>
</template>

<style scoped>
.operation {
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 24px;
}
.method {
  font-weight: 600;
}
details {
  margin: 8px 0;
}
summary {
  cursor: pointer;
}
</style>
