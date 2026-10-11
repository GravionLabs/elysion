/** A list of numbers with percentiles; at the sizes of a load test (some 100,000 samples) a sorted array is enough. */
export class Samples {
  #values: number[] = [];
  #sorted = true;

  add(value: number): void {
    this.#values.push(value);
    this.#sorted = false;
  }

  get count(): number {
    return this.#values.length;
  }

  /** The value below which `fraction` (0 to 1) of the samples lie; `NaN` without samples. */
  percentile(fraction: number): number {
    if (this.#values.length === 0) return Number.NaN;
    if (!this.#sorted) {
      this.#values.sort((a, b) => a - b);
      this.#sorted = true;
    }
    const index = Math.min(this.#values.length - 1, Math.ceil(fraction * this.#values.length) - 1);
    return this.#values[Math.max(0, index)]!;
  }

  get max(): number {
    return this.percentile(1);
  }
}

export function formatMs(value: number): string {
  return Number.isNaN(value) ? 'n/a' : `${value.toFixed(0)} ms`;
}
