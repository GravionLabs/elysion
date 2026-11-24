// The agent CLIs the loop can start. The project config names one of them (`deliver.harness`); the
// command line is built here, never read from a repository, so a change in a repository cannot make
// the loop run another program.

export type HarnessInput = {
  /** The slash command of the skill with its arguments. */
  prompt: string;
  /** Undefined: the default of the harness. */
  model?: string;
};

export type Harness = {
  /** The model the loop reports when none is given. */
  defaultModel: string;
  command(input: HarnessInput): string[];
  /** The stream is the stream-json of Claude Code: the loop reads steps, cost and context from it. */
  claudeStream: boolean;
};

export const HARNESSES: Record<string, Harness> = {
  claude: {
    defaultModel: 'sonnet',
    claudeStream: true,
    command: ({ prompt, model }) => [
      'claude',
      '-p',
      prompt,
      '--model',
      model ?? 'sonnet',
      '--permission-mode',
      'auto',
      '--output-format',
      'stream-json',
      '--verbose',
      // a wakeup keeps the process alive after the result; the review runs in the foreground
      '--disallowedTools',
      'ScheduleWakeup',
      'CronCreate',
    ],
  },
  // Flags checked against `copilot --help` (Copilot CLI 1.0.108). No stream format: the loop logs plain lines.
  copilot: {
    defaultModel: 'auto',
    claudeStream: false,
    command: ({ prompt, model }) => [
      'copilot',
      '-p',
      prompt,
      ...(model ? ['--model', model] : []),
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
      '--no-ask-user',
      '--no-color',
    ],
  },
};
