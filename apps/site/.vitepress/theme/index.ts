import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import OpenApiReference from './OpenApiReference.vue';

/** The default theme, plus the component that renders the public API's OpenAPI document (docs/api/reference.md). */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('OpenApiReference', OpenApiReference);
  },
} satisfies Theme;
