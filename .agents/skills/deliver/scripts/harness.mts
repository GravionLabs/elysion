// The agent CLIs the loop can start. The project config names one of them (`deliver.harness`); the
// command line is built here, never read from a repository, so a change in a repository cannot make
// the loop run another program.
import { DEFAULT_TIERS } from './resolve-model.mts';

export type HarnessInput = {
  /** The slash command of the skill with its arguments. */
  prompt: string;
  /** Undefined: the default of the harness. */
  model?: string;
  /** The reasoning effort, one of `efforts`. Undefined: the default of the harness. */
  effort?: string;
  /** Shell command prefixes (`git push`) the session may not run. */
  deny?: string[];
};

export type Harness = {
  /** The model of a command without one; the loop itself always names the model (session-models.mts). */
  defaultModel: string;
  command(input: HarnessInput): string[];
  efforts: string[];
  /** The stream is the stream-json of Claude Code: the loop reads steps, cost and context from it. */
  claudeStream: boolean;
};

export const HARNESSES: Record<string, Harness> = {
  claude: {
    defaultModel: DEFAULT_TIERS.claude.standard,
    claudeStream: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    command: ({ prompt, model, effort, deny = [] }) => [
      'claude',
      '-p',
      prompt,
      '--model',
      model ?? DEFAULT_TIERS.claude.standard,
      ...(effort ? ['--effort', effort] : []),
      '--permission-mode',
      'auto',
      '--output-format',
      'stream-json',
      '--verbose',
      // a wakeup keeps the process alive after the result
      '--disallowedTools',
      'ScheduleWakeup',
      'CronCreate',
      ...deny.map((command) => `Bash(${command}:*)`),
    ],
  },
  // Flags checked against `copilot --help` (Copilot CLI 1.0.116). No stream format: the loop logs plain lines.
  copilot: {
    defaultModel: DEFAULT_TIERS.copilot.standard,
    claudeStream: false,
    efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    command: ({ prompt, model, effort, deny = [] }) => [
      'copilot',
      '-p',
      prompt,
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--reasoning-effort', effort] : []),
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
      '--no-ask-user',
      '--no-color',
      ...deny.flatMap((command) => ['--deny-tool', `shell(${command})`]),
    ],
  },
};
