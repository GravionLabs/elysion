import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** The key of the history state with which the board list hands a new board's template to the board page. */
export const TEMPLATE_STATE_KEY = 'templateId';

/** A template in the BFF's catalog list: no scene. */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  createdAt: string;
}

/** One template with its scene, the text of an `.excalidraw` file. */
export interface TemplateContent extends TemplateInfo {
  scene: string;
}

@Injectable({ providedIn: 'root' })
export class TemplateApi {
  readonly #http = inject(HttpClient);

  /** The catalog, built-in templates first. */
  list(): Observable<TemplateInfo[]> {
    return this.#http.get<TemplateInfo[]>('/api/templates');
  }

  /** One template with its scene. */
  get(id: string): Observable<TemplateContent> {
    return this.#http.get<TemplateContent>(`/api/templates/${encodeURIComponent(id)}`);
  }
}
