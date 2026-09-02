process.env.OPENAI_AGENT_MODEL =
  process.env.OPENAI_AGENT_MODEL?.trim()
  || 'gpt-5.6-sol';

require('./file_manager_runtime_patch.cjs');
require('./file_manager_ipc.cjs');
require('./terminal_ipc.cjs');
require('./agent_follow_ipc.cjs');
require('./agent_ipc.cjs');
require('./main.cjs');
