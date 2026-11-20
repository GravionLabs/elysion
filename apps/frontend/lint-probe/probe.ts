// Lint probe (ADR 0006 of GravionLabs/skills, #918): every line marked "probe:" breaks one rule on purpose.
// lint-probe/probe.test.mjs lints this folder and fails when oxlint (the Angular JS plugin, the type-aware rules) or
// ESLint (the template rules) stops reporting one of them. Not imported anywhere, ignored by `pnpm lint` and the build.
import { Component, EventEmitter, NgModule, type OnDestroy, Output } from '@angular/core';
import type { HttpClient } from '@angular/common/http';

@Component({
  selector: 'wrong-prefix', // probe: @angular-eslint/component-selector
  standalone: false, // probe: @angular-eslint/prefer-standalone
  templateUrl: './probe.html',
})
export class Probe implements OnDestroy {
  @Output() onSelect = new EventEmitter<string>(); // probe: @angular-eslint/no-output-on-prefix
  @Output() click = new EventEmitter<void>(); // probe: @angular-eslint/no-output-native
  value = '';

  constructor(private readonly http: HttpClient) {} // probe: @angular-eslint/prefer-inject

  // probe: @angular-eslint/use-lifecycle-interface (no `implements OnInit`)
  ngOnInit(): void {
    this.load(); // probe: typescript/no-floating-promises
    ['a'].forEach(async () => this.load()); // probe: typescript/no-misused-promises
  }

  ngOnDestroy(): void {} // probe: @angular-eslint/no-empty-lifecycle-method

  async load(): Promise<void> {
    await this.value; // probe: typescript/await-thenable
  }

  pick(): void {
    this.onSelect.emit('pick');
  }
}

@Component({
  selector: 'app-inline-probe',
  template: '<p>inline</p>', // probe: @angular-eslint/component-max-inline-declarations
})
export class InlineProbe {}

@NgModule({ declarations: [Probe] })
export class ProbeModule {}
