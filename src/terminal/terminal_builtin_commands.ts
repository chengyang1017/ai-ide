const CLEAR_COMMANDS = new Set([
  'cls',
  'clear',
  'clear-host',
]);

function normalizedCommand(value: string): string {
  return value.trim().toLowerCase();
}

function clearTerminalOutput(): void {
  const output = document.querySelector<HTMLElement>(
    '[data-terminal-output]',
  );

  if (output) {
    output.textContent = '';
    output.scrollTop = 0;
  }
}

function handleBuiltInSubmit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement | null;
  if (!form?.matches('[data-terminal-form]')) {
    return;
  }

  const input = form.querySelector<HTMLInputElement>(
    '[data-terminal-input]',
  );
  if (!input) {
    return;
  }

  const command = normalizedCommand(input.value);
  if (!CLEAR_COMMANDS.has(command)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  input.value = '';
  clearTerminalOutput();
  input.focus();
}

// Capture before terminal_panel.ts handles the form submit, so screen-control
// commands are implemented by the IDE UI instead of being sent through the
// redirected PowerShell stdout/stderr pipe.
document.addEventListener(
  'submit',
  handleBuiltInSubmit,
  true,
);

// Some commands/tools do emit VT clear-screen sequences even without a PTY.
// The current terminal renderer strips ANSI escape codes, so detect those
// sequences before they disappear and translate them into a UI clear action.
const CLEAR_SEQUENCE_PATTERN = /\u001B\[(?:2J|3J|H|1;1H)/;

const outputObserver = new MutationObserver((records) => {
  for (const record of records) {
    const target = record.target as HTMLElement;
    const text = target.textContent ?? '';
    if (!CLEAR_SEQUENCE_PATTERN.test(text)) {
      continue;
    }

    target.textContent = text.replace(
      /\u001B\[(?:2J|3J|H|1;1H)/g,
      '',
    );
    target.scrollTop = 0;
    break;
  }
});

function watchTerminalOutput(): boolean {
  const output = document.querySelector<HTMLElement>(
    '[data-terminal-output]',
  );
  if (!output) {
    return false;
  }

  outputObserver.observe(output, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return true;
}

if (!watchTerminalOutput()) {
  const bootstrapObserver = new MutationObserver(() => {
    if (watchTerminalOutput()) {
      bootstrapObserver.disconnect();
    }
  });

  bootstrapObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

export {};
